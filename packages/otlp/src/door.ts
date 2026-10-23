/**
 * What the three OTLP doors (traces, logs, metrics) share once a request is in
 * hand: the refusal they render, the receiver policy they tag with, and the two
 * diagnostics they log. See specs/otlp/endpoint-path-canonicalisation.feature.
 */
import { createHash } from "node:crypto";

import { HandledError } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
import { createWarnThrottle, type Logger } from "@langwatch/observability";
import { counter } from "@langwatch/observability/metrics";
import { nowInstant } from "@langwatch/time";
import { type Span, SpanStatusCode } from "@opentelemetry/api";
import { z } from "zod";

import { OtlpIngestSourceBillingUnavailableError } from "./errors.ts";
import {
  applyOtlpReceiverPolicy,
  otlpReceiverPolicySchema,
  type OtlpReceiverRequest,
} from "./receiver-policy.ts";

export type OtlpSignal = "traces" | "logs" | "metrics";

/** One exporter request as a door hands it to its module: the wire bytes and the headers sent. */
export type OtlpDoorRequest = Readonly<{
  method: string;
  path: string;
  /** Lower-cased names, as `Headers` iterates them. */
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}>;

/** The outcomes every door shares beside its signal's own collection result. */
export type OtlpDoorRefusal =
  | Readonly<{ outcome: "refused"; refusal: HandledError }>
  | Readonly<{ outcome: "parse-failed" }>
  | Readonly<{ outcome: "not-found" }>;

export type OtlpDoorAnswer = Readonly<{ status: 200 | 400 | 401 | 403 | 404 | 503; body: object }>;

/** The source billing an ingestion key resolved, per signal, or why it could not. */
export const otlpSourcePolicySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    policies: z.record(z.enum(["traces", "logs", "metrics"]), otlpReceiverPolicySchema),
  }),
  z.object({ status: z.literal("failed"), error: z.unknown() }),
]);
export type OtlpSourcePolicy = z.infer<typeof otlpSourcePolicySchema>;

export type OtlpIngestCredentialInput = Readonly<{
  authorization: string | null;
  xAuthToken: string | null;
  xProjectId: string | null;
}>;

const otlpIngestProjectSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  organizationId: z.string(),
});
export type OtlpIngestProject = Readonly<z.infer<typeof otlpIngestProjectSchema>>;

/** A resolved receiver credential, handed by the OTLP ingest door as the route's session. */
const otlpIngestCredentialSchemaDefinition = z.object({
  project: otlpIngestProjectSchema,
  identity: z.object({
    apiKeyId: z.string().nullable(),
    organizationId: z.string(),
    ingestSourceType: z.string().nullable(),
    ingestionTemplateId: z.string().nullable(),
    sourcePolicy: otlpSourcePolicySchema.optional(),
  }),
});
export interface OtlpIngestCredentialSchema extends Named<
  typeof otlpIngestCredentialSchemaDefinition
> {}
export const otlpIngestCredentialSchema: OtlpIngestCredentialSchema =
  otlpIngestCredentialSchemaDefinition;
/** A refusal is thrown, and the receiver renders it. */
export type OtlpIngestCredential = Readonly<z.infer<typeof otlpIngestCredentialSchema>>;

/** The credential refusals the ingestion doors answer in their own wire, and nothing else. */
const DOOR_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "missing_credentials",
  "invalid_credentials",
  "api_key_permission_denied",
]);

/** A refusal the credential chain raised that an ingestion door renders itself. */
export function isIngestDoorRefusal(error: unknown): error is HandledError {
  return HandledError.isHandled(error) && DOOR_REFUSAL_CODES.has(error.code);
}

/** One door-refusal line per caller bucket per window; the counter below holds the full volume. */
const REFUSAL_LOG_WINDOW_MS = 60_000;
/** Callers share a bounded number of buckets, so the throttle's state cannot grow without limit. */
const REFUSAL_LOG_BUCKETS = 64;

const refusalLog = createWarnThrottle(REFUSAL_LOG_WINDOW_MS);

/** Every refused ingest request, by signal, reason code and status: no tenant, key or token. */
const ingestDoorRefusalsTotal = counter({
  name: "langwatch_ingest_door_refusals_total",
  description: "Ingest requests refused at the credential door, by signal, reason code and status.",
});

/** The slice of a span the client-fault guard writes and closes. */
type FaultSpan = Pick<Span, "recordException" | "setAttributes" | "setStatus" | "end">;

/**
 * Runs `body` in a span `open` starts and leaves open (a tracer's `startActiveSpan`), then closes
 * it: OK on success, UNSET with the exception and its code for a customer-fault refusal, ERROR
 * with its message for anything else. The error is rethrown either way.
 */
export function withClientFaultSpan<S extends FaultSpan, T>(
  open: (run: (span: S) => Promise<T>) => Promise<T>,
  body: (span: S) => Promise<T>,
): Promise<T> {
  return open(async (span) => {
    try {
      const value = await body(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return value;
    } catch (error) {
      recordFailure({ span, error });
      throw error;
    } finally {
      span.end();
    }
  });
}

function recordFailure({ span, error }: { span: FaultSpan; error: unknown }): void {
  if (HandledError.isHandled(error) && error.fault === "customer") {
    span.recordException(error);
    span.setAttributes({ "langwatch.error.code": error.code, "langwatch.error.fault": "customer" });
    return;
  }
  if (error instanceof Error) span.recordException(error);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
}

/** Clears the sampled-log state; tests only. */
export function resetIngestDoorRefusalLog(): void {
  refusalLog.reset();
}

/**
 * Records a credential refusal at an ingestion door. The counter takes every refusal; the warn
 * line is sampled per caller bucket, since an exporter retries a refused batch many times a
 * second. A suppressed refusal is still written, at debug.
 */
export function recordIngestDoorRefusal({
  logger,
  signal,
  error,
  diagnostics,
  now = nowInstant().epochMilliseconds,
}: {
  logger: Pick<Logger, "warn" | "debug">;
  signal: OtlpSignal;
  error: HandledError;
  diagnostics: Readonly<{ hasEmptyAuthToken: boolean } & Record<string, unknown>>;
  now?: number;
}): void {
  const refusalStatus = ingestDoorRefusalStatus(error);
  ingestDoorRefusalsTotal.inc({ signal, code: error.code, status: refusalStatus });

  const caller = `${String(diagnostics.userAgent ?? "")}|${String(diagnostics.forwardedFor ?? "")}`;
  const bucket = createHash("sha256").update(caller).digest().readUInt16BE(0) % REFUSAL_LOG_BUCKETS;
  const suppressed = refusalLog.claim({
    key: `${signal}|${error.code}|${diagnostics.hasEmptyAuthToken}|${bucket}`,
    now,
  });
  const message = diagnostics.hasEmptyAuthToken
    ? "Authentication failed: X-Auth-Token sent but empty"
    : "Authentication failed";

  if (suppressed === undefined) {
    logger.debug({ ...diagnostics, refusalStatus }, message);
    return;
  }
  logger.warn(
    {
      ...diagnostics,
      refusalStatus,
      ...(suppressed > 0 ? { suppressedRefusals: suppressed } : {}),
    },
    message,
  );
}

/** Whether the refusal is "we do not know this credential", not a ceiling on a key we know. */
export function isUnknownCredentialRefusal(error: HandledError): boolean {
  return error.code === "missing_credentials" || error.code === "invalid_credentials";
}

/** The ingestion doors preserve the key directory's two authentication statuses. */
export function ingestDoorRefusalStatus(error: HandledError): 401 | 403 {
  return error.httpStatus === 401 ? 401 : 403;
}

/** The sentence alone for an unknown credential, else the code, meta and remediation. */
export function ingestDoorRefusalBody(error: HandledError): object {
  if (isUnknownCredentialRefusal(error)) return { message: error.message };

  const { code, message, meta, tips, docsUrl, fault, retryable } = error;
  return {
    error: code,
    message,
    ...meta,
    ...(tips?.length ? { tips } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    ...(fault ? { fault } : {}),
    retryable: retryable === true,
  };
}

/** A shared outcome's answer; `unavailable` stored nothing, so it is OTLP's retryable 503. */
export function otlpDoorFailureAnswer({
  result,
  signal,
}: {
  result: OtlpDoorRefusal | Readonly<{ outcome: "unavailable"; errorMessage: string }>;
  signal: OtlpSignal;
}): OtlpDoorAnswer {
  switch (result.outcome) {
    case "refused":
      return {
        status: ingestDoorRefusalStatus(result.refusal),
        body: ingestDoorRefusalBody(result.refusal),
      };
    case "parse-failed":
      return { status: 400, body: { error: `Failed to parse ${signal}` } };
    case "not-found":
      return { status: 404, body: { error: "Not Found" } };
    case "unavailable":
      return { status: 503, body: { error: result.errorMessage } };
  }
}

/** A rejected body is unparsed and unredacted, so only its length may reach a log. */
export function otlpBodyForensics(body: ArrayBuffer | Uint8Array): { bodyBytes: number } {
  return { bodyBytes: body.byteLength };
}

/** A misconfigured fleet posts continuously, so a project/path pair is reported once a window. */
const CORRECTED_PATH_LOG_WINDOW_MS = 10 * 60 * 1000;
const CORRECTED_PATH_LOG_MAX_PAIRS = 1000;
const correctedPathLastLoggedAt = new Map<string, number>();

function correctedPathIsDueToLog({ pair, now }: { pair: string; now: number }): boolean {
  const last = correctedPathLastLoggedAt.get(pair);
  if (last !== void 0 && now - last < CORRECTED_PATH_LOG_WINDOW_MS) return false;

  if (correctedPathLastLoggedAt.size >= CORRECTED_PATH_LOG_MAX_PAIRS) {
    correctedPathLastLoggedAt.clear();
  }
  correctedPathLastLoggedAt.set(pair, now);
  return true;
}

/** Logged after authentication, not at the alias, since the project id makes it actionable. */
export function logCorrectedOtlpPath({
  originalPath,
  canonicalPath,
  projectId,
  logger,
}: {
  originalPath: string | null;
  canonicalPath: string;
  projectId: string;
  logger: Logger;
}): void {
  if (!originalPath || originalPath === canonicalPath) return;
  // A NUL cannot appear in a URL pathname, so no two pairs collide.
  const pair = [projectId, originalPath].join("\u0000");
  if (!correctedPathIsDueToLog({ pair, now: nowInstant().epochMilliseconds })) return;

  logger.warn(
    { projectId, originalPath, canonicalPath },
    "OTLP exporter posted to a non-canonical path; served from the canonical route",
  );
}

/** Tags the request with the ingestion key's source policy, dropping scopes outside it. */
export function applyReceiverProvenance({
  request,
  identity,
  signal,
  logger,
}: {
  request: OtlpReceiverRequest;
  identity: Readonly<{
    apiKeyId: string | null;
    ingestSourceType: string | null;
    sourcePolicy?: OtlpSourcePolicy;
  }>;
  signal: OtlpSignal;
  logger: Logger;
}): void {
  const isIngestionKey = identity.apiKeyId !== null && Boolean(identity.ingestSourceType);
  const source = identity.sourcePolicy;
  if (isIngestionKey && !source) {
    throw new OtlpIngestSourceBillingUnavailableError(identity.ingestSourceType ?? "");
  }

  if (isIngestionKey && source?.status === "failed") {
    throw source.error;
  }

  const policy = isIngestionKey && source?.status === "ready" ? source.policies[signal] : void 0;
  const { droppedScopes } = applyOtlpReceiverPolicy({
    request,
    signal,
    apiKeyId: identity.apiKeyId,
    policy,
  });

  if (droppedScopes > 0) {
    logger.warn(
      { droppedForeign: droppedScopes, apiKeyId: identity.apiKeyId },
      "dropped instrumentation scopes outside the authenticated ingestion policy",
    );
  }
}

/** Media types an OTLP door refuses with 415: OTLP is served over HTTP only, never gRPC framing. */
export const OTLP_REFUSED_MEDIA_TYPES = ["application/grpc"];
