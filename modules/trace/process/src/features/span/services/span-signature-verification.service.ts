import type { ApiKeyApi } from "@langwatch/api-key-contract";
import {
  BRAID_SIGNATURE_ATTRIBUTE,
  parseBraidSignature,
} from "@langwatch/api-key-contract/signing-key-wire-format";
import { VERIFIED_ATTRIBUTE_PREFIX } from "@langwatch/authorization";
import { createLogger } from "@langwatch/observability";
import type { OtlpSpan } from "@langwatch/otlp/trace-request";
import type { ProjectApi } from "@langwatch/project-contract";
import { OtlpTraceRequestService } from "@langwatch/trace-contract/otlp-decoding";

/** Longest a span waits on a signature check; past it the span is admitted unverified. */
export const SPAN_SIGNATURE_VERIFICATION_TIMEOUT_MS = 1_000;
/** A project's organisation, held this long: a signed span costs no lookup of its own. */
const ORGANIZATION_CACHE_TTL_MS = 10 * 60_000;
const ORGANIZATION_CACHE_MAX_ENTRIES = 10_000;

const logger = createLogger("langwatch:trace:span-signature-verification");

type SpanAttributes = OtlpSpan["attributes"];

/** What a span offers for verification, copied before any later step changes the span. */
type SpanSignature =
  | { kind: "signed"; signature: string; entries: Record<string, string> }
  | { kind: "unsigned" };

/**
 * Verification at ingest (ADR-201 §4): only the API key module answering `verified` writes
 * `langwatch.reserved.verified.<k>` = the signing project, per signed entry. Any other answer,
 * an error or a timeout leaves the span unverified and never refuses it.
 */
export class SpanSignatureVerificationService {
  readonly #organizations = new Map<string, { organizationId: string | null; at: number }>();

  private constructor(
    private readonly deps: {
      signatures: Pick<ApiKeyApi, "verifyBraidSignature">;
      projects: Pick<ProjectApi, "findIdentity">;
      timeoutMs: number;
      now: () => number;
    },
  ) {}

  static create(input: {
    signatures: Pick<ApiKeyApi, "verifyBraidSignature">;
    projects: Pick<ProjectApi, "findIdentity">;
    timeoutMs?: number;
    now?: () => number;
  }): SpanSignatureVerificationService {
    return new SpanSignatureVerificationService({
      signatures: input.signatures,
      projects: input.projects,
      timeoutMs: input.timeoutMs ?? SPAN_SIGNATURE_VERIFICATION_TIMEOUT_MS,
      now: input.now ?? Date.now,
    });
  }

  /**
   * The signed entries a span offers, read from the attributes as the store keeps them, or
   * unsigned. A signed key or the signature sent twice, or kept as anything but the one string
   * sent (a nested value flattened onto it), would verify one value and store another: unsigned.
   */
  static signatureOf(span: OtlpSpan): SpanSignature {
    const sentOf = (key: string) => span.attributes.filter((attribute) => attribute.key === key);
    const [sentSignature, ...again] = sentOf(BRAID_SIGNATURE_ATTRIBUTE);
    const signature = sentSignature?.value.stringValue;
    if (typeof signature !== "string" || again.length > 0) return { kind: "unsigned" };
    const parsed = parseBraidSignature({ attribute: signature });
    if (!parsed) return { kind: "unsigned" };
    const kept = OtlpTraceRequestService.normalizeOtlpAttributes(span.attributes);
    if (kept[BRAID_SIGNATURE_ATTRIBUTE] !== signature) return { kind: "unsigned" };
    const entries: Record<string, string> = {};
    for (const key of parsed.keys) {
      const sent = sentOf(key);
      if (sent.length === 0 && kept[key] === undefined) continue;
      const value = sent.length === 1 ? sent[0]?.value.stringValue : undefined;
      if (typeof value !== "string" || kept[key] !== value) return { kind: "unsigned" };
      entries[key] = value;
    }
    return { kind: "signed", signature, entries };
  }

  /** The verified marks to add to a span; empty unless the API key module answers verified. */
  async verifiedMarks({
    span,
    projectId,
  }: {
    span: OtlpSpan;
    projectId: string;
  }): Promise<SpanAttributes> {
    // Before any await: the caller goes on changing the span once this returns.
    const signed = SpanSignatureVerificationService.signatureOf(span);
    if (signed.kind === "unsigned") return [];
    const { traceId } = span;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<SpanAttributes>((resolve) => {
      timer = setTimeout(() => {
        logger.warn({ projectId, traceId }, "signature check timed out; span stays unverified");
        resolve([]);
      }, this.deps.timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([this.#marks({ projectId, traceId, signed }), timedOut]);
    } catch (error) {
      logger.warn({ error, projectId, traceId }, "signature check failed; span stays unverified");
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async #marks({
    projectId,
    traceId,
    signed,
  }: {
    projectId: string;
    traceId: string;
    signed: Extract<SpanSignature, { kind: "signed" }>;
  }): Promise<SpanAttributes> {
    const organizationId = await this.#organizationOf(projectId);
    if (organizationId === null) return [];
    const verdict = await this.deps.signatures.verifyBraidSignature({
      organizationId,
      traceId,
      entries: signed.entries,
      signature: signed.signature,
    });
    if (verdict.outcome !== "verified") return [];
    return verdict.keys
      .filter((key) => signed.entries[key] !== undefined)
      .map((key) => ({
        key: `${VERIFIED_ATTRIBUTE_PREFIX}${key}`,
        value: { stringValue: verdict.signingProjectId },
      }));
  }

  async #organizationOf(projectId: string): Promise<string | null> {
    const at = this.deps.now();
    const held = this.#organizations.get(projectId);
    if (held && at - held.at < ORGANIZATION_CACHE_TTL_MS) return held.organizationId;
    const identity = await this.deps.projects.findIdentity(projectId);
    if (this.#organizations.size >= ORGANIZATION_CACHE_MAX_ENTRIES) this.#organizations.clear();
    const organizationId = identity?.organizationId ?? null;
    this.#organizations.set(projectId, { organizationId, at });
    return organizationId;
  }
}
