import {
  readDomainError,
  type DomainErrorShape,
} from "~/features/automations/logic/errorExplainer";

/**
 * Langy error explainer (ADR-045).
 *
 * The platform serializes handled `DomainError`s to `{ kind, meta, httpStatus,
 * telemetry, reasons }` — over tRPC as `error.data.domainError`, and (new in
 * this PR) over the chat stream as a JSON-encoded string in the error part.
 * This module turns either into a keyed presentation the UI renders:
 *
 *   - `card`     — a titled, actionable explanation (the default for handled).
 *   - `inline`   — a compact one-liner beside the failed message.
 *   - `suppress` — NOT an error at all: not-connected / no-data conditions
 *                  render the connect card / empty state instead of red.
 *
 * Copy is keyed on an EXACT, static list of known `kind`s — never a heuristic
 * match on the string — so a new backend kind lands in the explicit generic
 * default (with its `meta` + `reasons` surfaced for debugging) rather than
 * being silently pattern-matched into the wrong bucket. `unknown` (unhandled)
 * gets one calm generic message plus a trace id.
 */

export type LangyErrorRender = "card" | "inline" | "suppress";

export interface LangyErrorAction {
  label: string;
  kind: "connect-github" | "configure-model" | "retry";
}

/** One serialized reason from the DomainError chain (recursive). */
export interface LangySerializedReason {
  kind: string;
  meta?: Record<string, unknown>;
  reasons?: LangySerializedReason[];
}

export interface LangyErrorPresentation {
  kind: string;
  title: string;
  description: string;
  render: LangyErrorRender;
  action?: LangyErrorAction;
  /** Present for unknown/unhandled errors so support can correlate. */
  traceId?: string;
  /** Renderable domain metadata, surfaced under the message when present. */
  meta?: Record<string, unknown>;
  /** The reason chain, surfaced under the message for debugging when present. */
  reasons?: LangySerializedReason[];
}

/** Richer than the automations shape: also carries trace id + reason chain. */
export interface LangyDomainError extends DomainErrorShape {
  traceId?: string;
  reasons?: LangySerializedReason[];
}

/**
 * The exact set of Langy-emittable handled `kind`s. Adding a new handled kind
 * to the backend means adding it here — the typechecker won't force it, but the
 * `KNOWN_LANGY_ERROR_KINDS` array keeps the source of truth in one place and is
 * pinned by a test.
 */
export const KNOWN_LANGY_ERROR_KINDS = [
  "langy_conversation_not_found",
  "langy_conversation_not_owned",
] as const;

function parseReasons(value: unknown): LangySerializedReason[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const reasons = value
    .filter((r): r is { kind: unknown } => !!r && typeof r === "object")
    .filter((r) => typeof r.kind === "string")
    .map((r) => {
      const rec = r as {
        kind: string;
        meta?: unknown;
        reasons?: unknown;
      };
      return {
        kind: rec.kind,
        meta:
          rec.meta && typeof rec.meta === "object"
            ? (rec.meta as Record<string, unknown>)
            : undefined,
        reasons: parseReasons(rec.reasons),
      };
    });
  return reasons.length > 0 ? reasons : undefined;
}

/**
 * Parse a chat-stream error part. The stream now carries the serialized domain
 * error as a JSON string (see `serializeStreamError` in routes/langy.ts);
 * returns null for a plain-string legacy error so the caller can fall back.
 */
export function readLangyStreamError(
  message: string | undefined | null,
): LangyDomainError | null {
  if (!message) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as {
    kind?: unknown;
    meta?: unknown;
    httpStatus?: unknown;
    telemetry?: { traceId?: unknown };
    reasons?: unknown;
  };
  if (typeof value.kind !== "string") return null;
  return {
    kind: value.kind,
    httpStatus: typeof value.httpStatus === "number" ? value.httpStatus : 500,
    meta:
      value.meta && typeof value.meta === "object"
        ? (value.meta as Record<string, unknown>)
        : {},
    traceId:
      value.telemetry && typeof value.telemetry.traceId === "string"
        ? value.telemetry.traceId
        : undefined,
    reasons: parseReasons(value.reasons),
  };
}

/** Read a Langy domain error off a tRPC client error (`error.data.domainError`). */
export function readLangyTrpcError(err: unknown): LangyDomainError | null {
  const domain = readDomainError(err);
  if (!domain) return null;
  const serialized = (
    err as {
      data?: {
        domainError?: { telemetry?: { traceId?: unknown }; reasons?: unknown };
      };
    }
  )?.data?.domainError;
  const traceId = serialized?.telemetry?.traceId;
  return {
    ...domain,
    traceId: typeof traceId === "string" ? traceId : undefined,
    reasons: parseReasons(serialized?.reasons),
  };
}

export function explainLangyError(
  domain: LangyDomainError,
): LangyErrorPresentation {
  // Always carried through for debugging, regardless of the matched case.
  const debug = {
    meta: Object.keys(domain.meta).length > 0 ? domain.meta : undefined,
    reasons: domain.reasons,
  };

  switch (domain.kind) {
    case "langy_conversation_not_found":
      return {
        kind: domain.kind,
        title: "Conversation not found",
        description:
          "This conversation is no longer available. Start a new chat to keep going.",
        render: "card",
        ...debug,
      };

    case "langy_conversation_not_owned":
      return {
        kind: domain.kind,
        title: "This conversation belongs to someone else",
        description:
          "You can view shared conversations but only the owner can continue them.",
        render: "card",
        ...debug,
      };

    case "unknown":
      return {
        kind: "unknown",
        title: "Something went wrong",
        description:
          "Langy hit an unexpected error. Try again — if it keeps happening, share the id below with support.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        traceId: domain.traceId,
        ...debug,
      };

    default:
      // A handled kind we don't have bespoke copy for yet: still useful, never
      // a raw string, and its meta + reasons are surfaced for debugging.
      return {
        kind: domain.kind,
        title: "Langy couldn't finish that",
        description: "The request was rejected. Try rephrasing or start again.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        traceId: domain.traceId,
        ...debug,
      };
  }
}
