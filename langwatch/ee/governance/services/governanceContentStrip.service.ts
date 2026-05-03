/**
 * GovernanceContentStripService — receiver-side gen_ai content stripping
 * ("no-spy mode"). Drops prompt + completion + system-instruction
 * payloads from gateway-origin spans BEFORE they hit ClickHouse, so a
 * tenant operating under a "we cannot read employee chat content"
 * policy gets the guarantee enforced by the pipeline rather than by
 * trust + later cleanup.
 *
 * Three modes per `Organization.governanceLogContentMode`:
 *   - "full"      (default) — store everything (current behavior)
 *   - "strip_io"  — drop input/output messages + system instructions
 *   - "strip_all" — strip_io + tool-call arguments + tool-call results
 *
 * Scope:
 *   - Only spans with `langwatch.origin = "gateway"` are affected.
 *     User-application traces (sent via /api/otel/v1/traces directly)
 *     are NOT stripped — those are the customer's own data flow.
 *   - Forward-looking only; historical CH rows are untouched.
 *
 * Performance: org-mode lookups are cached in-process for 30s with a
 * stampede-safe single-flight resolver (concurrent lookups for the
 * same org dedupe to one Prisma round-trip). The cache is intentionally
 * small (TTL 30s, no LRU eviction) — the pipeline ingests batched spans
 * burst-wise so a brief cache window dramatically reduces Prisma load
 * without compromising the fact that an admin's mode-flip propagates
 * within ~30s.
 *
 * Spec: specs/ai-governance/no-spy-mode/no-spy-mode.feature
 */
import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrismaClient } from "~/server/db";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:governance-content-strip");

export type GovernanceLogContentMode = "full" | "strip_io" | "strip_all";

const MODE_VALUES: readonly GovernanceLogContentMode[] = [
  "full",
  "strip_io",
  "strip_all",
] as const;

const ORG_MODE_CACHE_TTL_MS = 30_000;

const GATEWAY_ORIGIN_VALUE = "gateway";
const ORG_ID_ATTR = "langwatch.organization_id";
const ORIGIN_ATTR = "langwatch.origin";

/**
 * Keys whose values are user-conversational content (prompts, replies,
 * system messages). Dropped on `strip_io` and `strip_all`.
 */
const STRIP_IO_KEYS = [
  // Modern OTel GenAI semantic conventions
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.system_instructions",
  // Legacy GenAI attributes
  "gen_ai.prompt",
  "gen_ai.completion",
  // LangWatch-canonicalised input/output (set by legacyOtel extractor)
  "langwatch.input",
  "langwatch.output",
  // Vercel AI SDK
  "ai.prompt",
  "ai.prompt.messages",
  "ai.response",
  "ai.response.text",
  "ai.response.object",
  // OpenInference
  "llm.input_messages",
  "llm.output_messages",
  // Top-level input/output value patterns (Traceloop, OpenInference, etc.)
  "input",
  "input.value",
  "output",
  "output.value",
  "raw_input",
  "traceloop.entity.input",
  "traceloop.entity.output",
] as const;

/**
 * Tool-call payloads. These are only stripped on `strip_all` because
 * tool-call arguments + results are sometimes the only signal an
 * operator has for diagnosing why a multi-turn agent ran amok. Orgs
 * that want zero conversational *content* of any kind enable strip_all.
 */
const STRIP_TOOL_KEYS = [
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
  "ai.toolCall",
  "ai.toolCall.args",
] as const;

/** Marker attribute we stamp on stripped spans so the UI can show a banner. */
const STRIPPED_MARKER_ATTR = "langwatch.governance.content_stripped";
const STRIPPED_MODE_ATTR = "langwatch.governance.content_strip_mode";

interface CachedMode {
  mode: GovernanceLogContentMode;
  expiresAtMs: number;
}

export class GovernanceContentStripService {
  private readonly cache = new Map<string, CachedMode>();
  private readonly inflight = new Map<
    string,
    Promise<GovernanceLogContentMode>
  >();

  constructor(private readonly prisma: PrismaClient) {}

  static create(
    prisma: PrismaClient = defaultPrismaClient,
  ): GovernanceContentStripService {
    return new GovernanceContentStripService(prisma);
  }

  /**
   * Resolve the active mode for an organization, with TTL cache. Falls
   * back to "full" on lookup error (fail-open is the right default for
   * a privacy filter of this kind — a transient DB blip should not
   * silently start storing content for an org configured to strip).
   *
   * Wait, that's backwards: fail-open means we DO store content on
   * error, which violates the org's policy. We want fail-CLOSED: on
   * lookup error, default to "strip_io" rather than "full". TODO once
   * the lookup pipe is observable end-to-end. For now keep the
   * conservative path explicit:
   */
  async modeForOrganization(
    organizationId: string,
  ): Promise<GovernanceLogContentMode> {
    const now = Date.now();
    const cached = this.cache.get(organizationId);
    if (cached && cached.expiresAtMs > now) return cached.mode;

    // Single-flight: dedupe concurrent lookups for the same org.
    const existing = this.inflight.get(organizationId);
    if (existing) return existing;

    const promise = this.fetchMode(organizationId)
      .then((mode) => {
        this.cache.set(organizationId, {
          mode,
          expiresAtMs: Date.now() + ORG_MODE_CACHE_TTL_MS,
        });
        return mode;
      })
      .finally(() => {
        this.inflight.delete(organizationId);
      });
    this.inflight.set(organizationId, promise);
    return promise;
  }

  private async fetchMode(
    organizationId: string,
  ): Promise<GovernanceLogContentMode> {
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { governanceLogContentMode: true },
      });
      const value = org?.governanceLogContentMode ?? "full";
      if (!MODE_VALUES.includes(value as GovernanceLogContentMode)) {
        logger.warn(
          { organizationId, value },
          "Unknown governanceLogContentMode value, defaulting to 'full'",
        );
        return "full";
      }
      return value as GovernanceLogContentMode;
    } catch (error) {
      // Fail-closed: privacy filter cannot silently disable on DB error.
      // Strip-IO is the safest default — drops conversational content
      // but keeps observability metadata (tokens, latency, cost).
      logger.error(
        { organizationId, error },
        "Failed to load governanceLogContentMode, failing closed to strip_io",
      );
      return "strip_io";
    }
  }

  /**
   * Apply the strip transform to a span attributes record. Pure +
   * sync: returns a new object with the content keys removed when
   * applicable, or the original object unchanged when the mode is
   * "full" (no allocations on the happy path).
   */
  static stripSpanAttributes({
    attributes,
    mode,
  }: {
    attributes: Record<string, unknown>;
    mode: GovernanceLogContentMode;
  }): Record<string, unknown> {
    if (mode === "full") return attributes;
    const keys =
      mode === "strip_all"
        ? [...STRIP_IO_KEYS, ...STRIP_TOOL_KEYS]
        : STRIP_IO_KEYS;
    let out: Record<string, unknown> | null = null;
    for (const k of keys) {
      if (k in attributes) {
        if (!out) out = { ...attributes };
        delete out[k];
      }
    }
    if (!out) return attributes;
    out[STRIPPED_MARKER_ATTR] = true;
    out[STRIPPED_MODE_ATTR] = mode;
    return out;
  }

  /**
   * Same shape as stripSpanAttributes but for span events (tool-call
   * events under `gen_ai.*` semantic conventions sometimes carry the
   * conversational content as event attributes rather than span
   * attributes).
   */
  static stripEventAttributes({
    attributes,
    mode,
  }: {
    attributes: Record<string, unknown>;
    mode: GovernanceLogContentMode;
  }): Record<string, unknown> {
    return GovernanceContentStripService.stripSpanAttributes({
      attributes,
      mode,
    });
  }

  /**
   * Decide whether this span is subject to the strip policy. Returns
   * the org-id when applicable, null otherwise (caller short-circuits
   * the async mode lookup).
   */
  static governanceTargetOrgId(
    spanAttributes: Record<string, unknown>,
  ): string | null {
    if (spanAttributes[ORIGIN_ATTR] !== GATEWAY_ORIGIN_VALUE) return null;
    const orgId = spanAttributes[ORG_ID_ATTR];
    if (typeof orgId !== "string" || orgId.length === 0) return null;
    return orgId;
  }

  /** Test-only: clear cached mode lookups. */
  clearCache(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}
