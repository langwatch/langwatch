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
  /**
   * A Grafana deep link to the failing trace, present when a Grafana is
   * configured (locally, whenever the observability stack is up). The UI turns
   * it into a "view trace" link. Safe in production too — Grafana is
   * access-controlled, so the URL is harmless to a user who can't reach it.
   */
  traceUrl?: string;
  /** Renderable domain metadata, surfaced under the message when present. */
  meta?: Record<string, unknown>;
  /** The reason chain, surfaced under the message for debugging when present. */
  reasons?: LangySerializedReason[];
}

/** Richer than the automations shape: also carries trace id + reason chain. */
export interface LangyDomainError extends DomainErrorShape {
  traceId?: string;
  traceUrl?: string;
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
  // Turn-execution failures (see server/app-layer/langy/execution/langy-turn-errors.ts).
  "langy_agent_unavailable",
  "langy_agent_at_capacity",
  "langy_agent_session_lost",
  "langy_turn_timeout",
  "langy_worker_restarting",
  "langy_worker_spawn_failed",
  "langy_turn_stalled",
  // NOT a failure — an unmet prerequisite. See the `suppress` case below.
  "langy_github_not_connected",
  // Turn-START rejections from the control plane (app-layer LangyTurnService,
  // see server/app-layer/langy/errors.ts). These reach the browser as coded
  // TRPCErrors from the create/continue mutations — NOT from the worker's turn
  // classifier — so they need their own copy rather than the generic default.
  "langy_model_not_configured",
  "langy_model_not_allowed",
  "langy_egress_misconfigured",
  "langy_insufficient_scope",
  "langy_turn_in_progress",
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
    telemetry?: { traceId?: unknown; traceUrl?: unknown };
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
    traceUrl:
      value.telemetry && typeof value.telemetry.traceUrl === "string"
        ? value.telemetry.traceUrl
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
        domainError?: {
          telemetry?: { traceId?: unknown; traceUrl?: unknown };
          reasons?: unknown;
        };
      };
    }
  )?.data?.domainError;
  const traceId = serialized?.telemetry?.traceId;
  const traceUrl = serialized?.telemetry?.traceUrl;
  return {
    ...domain,
    traceId: typeof traceId === "string" ? traceId : undefined,
    traceUrl: typeof traceUrl === "string" ? traceUrl : undefined,
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

    case "langy_agent_unavailable":
      return {
        kind: domain.kind,
        title: "Langy is unavailable",
        description:
          "Langy can't be reached right now. Your message is safe — send it again in a moment.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_agent_at_capacity":
      return {
        kind: domain.kind,
        title: "Langy is busy right now",
        description:
          "Too many conversations are running at once. Give it a few seconds and try again.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_agent_session_lost":
      return {
        kind: domain.kind,
        title: "Langy lost its place",
        description:
          "Langy dropped this conversation before the reply finished. Send your message again to pick it back up.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_turn_timeout":
      return {
        kind: domain.kind,
        title: "That took too long",
        description:
          "Langy didn't finish in time. Try again, or ask for a narrower slice — a shorter time range or a single trace.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_turn_stalled":
      // Found by the liveness sweep, not by the turn — the pod died mid-reply.
      // The user's message is safely on record, so this is a retry, not a loss.
      return {
        kind: domain.kind,
        title: "Langy stopped mid-reply",
        description:
          "Langy stopped before it finished. Nothing was lost — try again.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_worker_spawn_failed":
      // The manager tried to start a worker for this turn and it never came up.
      // Nothing the user did is wrong and nothing is lost — their message is on
      // record — so this reads as a hiccup with a retry, not a fault.
      return {
        kind: domain.kind,
        title: "Langy couldn't start up",
        description:
          "Langy failed to get going for this reply. Nothing was lost — try again in a moment.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_worker_restarting":
      return {
        kind: domain.kind,
        title: "Langy restarted",
        description:
          "An update interrupted this reply. Nothing was lost — send your message again.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_github_not_connected":
      // The ONLY suppressed kind, and the reason the mode exists.
      //
      // Langy needing GitHub and not having it is a setup step, not a fault:
      // nothing broke, the user did nothing wrong, and there is a perfectly good
      // next action. Rendering it red would be the product blaming someone for
      // not having finished onboarding. `suppress` means the caller draws the
      // connect card in the message flow instead (see LangyPanel), so the answer
      // to "I need GitHub" is a Connect button exactly where the turn stopped.
      //
      // The title/description are still populated: they are what the card falls
      // back to if a future caller renders this generically, and they are what a
      // test reads. Nothing in the UI shows them today.
      return {
        kind: domain.kind,
        title: "Connect GitHub to continue",
        description:
          "Langy needs access to your GitHub account to open pull requests.",
        render: "suppress",
        action: { label: "Connect GitHub", kind: "connect-github" },
        ...debug,
      };

    case "langy_model_not_configured":
      // A prerequisite, not a fault: retrying the same send won't help until a
      // model is set, so this offers the setup action instead of a retry.
      return {
        kind: domain.kind,
        title: "Choose a model for Langy",
        description:
          "Langy needs a model to run. Pick one in your project's model settings, then try again.",
        render: "card",
        action: { label: "Configure model", kind: "configure-model" },
        ...debug,
      };

    case "langy_model_not_allowed":
      // The picked override isn't on the project's Langy allowlist. Deterministic
      // — the identical request fails again — so no retry; the meta.model is
      // surfaced so the user sees which one was rejected.
      return {
        kind: domain.kind,
        title: "That model isn't available here",
        description:
          "The model you picked isn't enabled for this project. Choose one of the configured models and send again.",
        render: "card",
        action: { label: "Configure model", kind: "configure-model" },
        ...debug,
      };

    case "langy_egress_misconfigured":
      // Fail-closed network policy: Langy refuses to run rather than leak. Not a
      // user error and not a retry — an admin has to fix the policy.
      return {
        kind: domain.kind,
        title: "Langy is blocked by a network policy",
        description:
          "Langy's outbound network policy for this project is misconfigured, so it can't run safely. Ask a workspace admin to review it.",
        render: "card",
        ...debug,
      };

    case "langy_insufficient_scope":
      // The caller holds none of Langy's permissions in this project. A
      // permissions gap an admin resolves — retrying won't change it.
      return {
        kind: domain.kind,
        title: "Langy doesn't have access here",
        description:
          "Langy doesn't have the permissions it needs in this project. Ask a workspace admin to grant them.",
        render: "card",
        ...debug,
      };

    case "langy_turn_in_progress":
      // One turn at a time per conversation. A retry would just 409 again, so
      // there's no retry action — the answer is to wait for the reply to finish.
      return {
        kind: domain.kind,
        title: "Langy is still replying",
        description:
          "There's already a response in progress for this conversation. Wait for it to finish before sending another message.",
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
        traceUrl: domain.traceUrl,
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
        traceUrl: domain.traceUrl,
        ...debug,
      };
  }
}
