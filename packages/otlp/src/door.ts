/**
 * What the three OTLP doors (traces, logs, metrics) share once a request is in
 * hand: the refusal they render, the receiver policy they tag with, and the two
 * diagnostics they log. See specs/otlp/endpoint-path-canonicalisation.feature.
 */
import { HandledError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { OtlpIngestSourceBillingUnavailableError } from "./errors.ts";
import {
  applyOtlpReceiverPolicy,
  type OtlpReceiverPolicy,
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
export type OtlpSourcePolicy =
  | { status: "ready"; policies: Record<OtlpSignal, OtlpReceiverPolicy> }
  | { status: "failed"; error: unknown };

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
  const { droppedScopes } = applyOtlpReceiverPolicy(request, signal, identity.apiKeyId, policy);

  if (droppedScopes > 0) {
    logger.warn(
      { droppedForeign: droppedScopes, apiKeyId: identity.apiKeyId },
      "dropped instrumentation scopes outside the authenticated ingestion policy",
    );
  }
}
