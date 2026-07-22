import {
  explainHandledError,
  type HandledErrorShape,
  readHandledError,
} from "~/features/errors";

/**
 * Langy error explainer (ADR-045).
 *
 * The platform serializes handled `HandledError`s to `{ code, kind, meta,
 * httpStatus, traceId, spanId, reasons }` — over tRPC as `error.data.error`, and (new in
 * this PR) over the chat stream as a JSON-encoded string in the error part.
 * This module turns either into a keyed presentation the UI renders:
 *
 *   - `card`     — a titled, actionable explanation (the default for handled).
 *   - `inline`   — a compact one-liner beside the failed message.
 *   - `suppress` — NOT an error at all: not-connected / no-data conditions
 *                  render the connect card / empty state instead of red.
 *
 * The WORDS are not decided here. Every title and description comes from the
 * shared presentation registry (`features/errors/logic/presentation.ts`),
 * keyed by code; this module decides only what Langy owns — how the failure is
 * rendered, which action button it offers, and whether the meta and reason
 * chain are surfaced for debugging. Both files used to author copy for the
 * same twenty-one codes, and they had drifted into contradicting each other:
 * `langy_egress_misconfigured` was "we're on it, try again shortly" in one and
 * "a network policy an admin must fix" in the other. Only one could be true.
 *
 * Cases are keyed on an EXACT, static list of known `kind`s — never a
 * heuristic match on the string — so a new backend kind lands in the explicit
 * generic default (with its `meta` + `reasons` surfaced for debugging) rather
 * than being silently pattern-matched into the wrong bucket. `unknown`
 * (unhandled) gets one calm generic message plus a trace id.
 */

export type LangyErrorRender =
  | "card"
  | "inline"
  | "suppress"
  // A transient composer-level notice, not a message-history card: rendered as a
  // dismissable box attached above the composer, leaving the user's draft in
  // place (ADR-058). Used for "one turn at a time" — a wait, not a turn failure.
  | "composer-notice";

export interface LangyErrorAction {
  label: string;
  kind: "connect-github" | "configure-model" | "retry";
}

/** One serialized reason from the HandledError chain (recursive). */
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
   * The raw domain code, shown under the message on the GENERIC cards only.
   *
   * A card that says "Something went wrong" and nothing else is unactionable
   * for everyone: support cannot correlate it and a developer cannot tell
   * `clickhouse_unavailable` (your local stack is down) from a genuine bug.
   * The bespoke cases do not set this — their copy already names the problem,
   * and a code under prose that already explains itself is just noise.
   */
  code?: string;
  /** Renderable domain metadata, surfaced under the message when present. */
  meta?: Record<string, unknown>;
  /** The reason chain, surfaced under the message for debugging when present. */
  reasons?: LangySerializedReason[];
}

/**
 * The shared shape, with the reason chain narrowed to Langy's own parsed
 * representation — Langy is the one surface that renders reasons (in a card,
 * for an engineer debugging an agent turn) rather than hiding them.
 */
export interface LangyDomainError
  extends Omit<
    HandledErrorShape,
    "reasons" | "traceId" | "fault" | "tips" | "docsUrl"
  > {
  traceId?: string;
  reasons?: LangySerializedReason[];
  // Optional, unlike the shared shape: Langy also builds this type by hand for
  // stream frames and for a synthesised "unknown", neither of which has a
  // fault or remediation to report. `readLangyTrpcError` still fills them in
  // from the shared reader when the error came over tRPC.
  fault?: HandledErrorShape["fault"];
  tips?: HandledErrorShape["tips"];
  docsUrl?: HandledErrorShape["docsUrl"];
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
  // The worker stopped mid-reply and the control plane exhausted its own recovery
  // — a FINAL state, not a client auto-retry. See langyRecoveryPolicy.ts.
  "langy_worker_stopped",
  // The agent itself reported the turn failed (its LLM call was rejected) —
  // the worker is fine, the reply failed. Terminal with a manual retry.
  "langy_agent_errored",
  // NOT a failure — an unmet prerequisite. See the `suppress` case below.
  "langy_github_not_connected",
  // GitHub access exists but the repository the agent reached for isn't
  // covered by the app installation — a grant-access step, not a fault.
  "langy_github_repo_not_accessible",
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
    code?: unknown;
    // Deprecated pre-`HandledError` discriminant — read as a fallback so an
    // older payload still resolves during the transition.
    kind?: unknown;
    meta?: unknown;
    httpStatus?: unknown;
    traceId?: unknown;
    reasons?: unknown;
  };
  const code =
    typeof value.code === "string"
      ? value.code
      : typeof value.kind === "string"
        ? value.kind
        : null;
  if (code === null) return null;
  return {
    code,
    httpStatus: typeof value.httpStatus === "number" ? value.httpStatus : 500,
    meta:
      value.meta && typeof value.meta === "object"
        ? (value.meta as Record<string, unknown>)
        : {},
    traceId: typeof value.traceId === "string" ? value.traceId : undefined,
    reasons: parseReasons(value.reasons),
  };
}

/** Read a Langy domain error off a tRPC client error (`error.data.error`). */
export function readLangyTrpcError(err: unknown): LangyDomainError | null {
  const domain = readHandledError(err);
  if (!domain) return null;
  // The shared reader already lifted and validated traceId; only the reason
  // chain needs Langy's own parse, since it renders them.
  return { ...domain, reasons: parseReasons(domain.reasons) };
}

/**
 * The registry's words for this code.
 *
 * `LangyDomainError` is the same shape with the remediation channel made
 * optional (a stream frame and a synthesised "unknown" have no fault or tips),
 * so the gaps are filled with the server-side defaults before asking. Reasons
 * are dropped: the registry never reads them, and Langy's parsed form is its
 * own.
 */
function registryCopy(domain: LangyDomainError) {
  return explainHandledError({
    code: domain.code,
    meta: domain.meta,
    httpStatus: domain.httpStatus,
    fault: domain.fault ?? "customer",
    tips: domain.tips ?? [],
    docsUrl: domain.docsUrl,
    traceId: domain.traceId,
    reasons: [],
  });
}

export function explainLangyError(
  domain: LangyDomainError,
): LangyErrorPresentation {
  // Always carried through for debugging, regardless of the matched case.
  const debug = {
    meta: Object.keys(domain.meta).length > 0 ? domain.meta : undefined,
    reasons: domain.reasons,
  };

  const { title, description, isRegistered } = registryCopy(domain);
  const copy = { kind: domain.code, title, description };
  const retry = { label: "Try again", kind: "retry" } as const;

  switch (domain.code) {
    case "langy_conversation_not_found":
    case "langy_conversation_not_owned":
      return { ...copy, render: "card", ...debug };

    case "langy_agent_unavailable":
    case "langy_agent_at_capacity":
    case "langy_agent_session_lost":
    case "langy_turn_timeout":
      return { ...copy, render: "card", action: retry, ...debug };

    case "langy_worker_stopped":
      // The worker stopped mid-reply (its process died, or the liveness sweep
      // re-dispatched it and it never came back). A FINAL state: the control plane
      // already exhausted its recovery, so this offers a manual "Try again" but is
      // never auto-retried — re-driving would only walk into the same dead worker,
      // which is exactly the flicker this replaced. Nothing was lost: the user's
      // message is on record, so retrying is safe, it is just their call.
      return { ...copy, render: "card", action: retry, ...debug };

    case "langy_agent_errored":
      // The agent reported its own failure — usually the model call was
      // rejected upstream. Nothing crashed and nothing was lost. Deterministic,
      // so no auto-retry — the user decides.
      return { ...copy, render: "card", action: retry, ...debug };

    case "langy_worker_spawn_failed":
      // The manager tried to start a worker for this turn and it never came up.
      // Nothing the user did is wrong and nothing is lost — their message is on
      // record — so this reads as a hiccup with a retry, not a fault.
      return { ...copy, render: "card", action: retry, ...debug };

    case "langy_worker_restarting":
      return { ...copy, render: "card", action: retry, ...debug };

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
      // The title/description still come through: they are what the card falls
      // back to if a future caller renders this generically, and they are what a
      // test reads. Nothing in the UI shows them today.
      return {
        ...copy,
        render: "suppress",
        action: { label: "Install GitHub App", kind: "connect-github" },
        ...debug,
      };

    case "langy_github_repo_not_accessible":
      // GitHub access exists; the specific repository isn't covered by the app
      // installation. Deterministic — the identical request 404s identically —
      // so no retry: the fix is granting the app access to that repository on
      // GitHub (Settings → Integrations → Configure deep-links there).
      return { ...copy, render: "card", ...debug };

    case "langy_model_not_configured":
    case "langy_model_not_allowed":
      // A prerequisite, not a fault: retrying the same send won't help until the
      // model is set or swapped, so this offers the setup action instead of a
      // retry. `meta.model` rides along so the user sees which one was rejected.
      return {
        ...copy,
        render: "card",
        action: { label: "Configure model", kind: "configure-model" },
        ...debug,
      };

    case "langy_egress_misconfigured":
      // Fail-closed network policy: Langy refuses to run rather than leak. Not a
      // user error and not a retry — an admin has to fix the policy.
      return { ...copy, render: "card", ...debug };

    case "langy_insufficient_scope":
      // The caller holds none of Langy's permissions in this project. A
      // permissions gap an admin resolves — retrying won't change it.
      return { ...copy, render: "card", ...debug };

    case "langy_turn_in_progress":
      // One turn at a time per conversation. A retry would just 409 again, so
      // there's no retry action — the answer is to wait for the reply to finish.
      // It is a WAIT, not a turn failure, so it rides above the composer as a
      // dismissable notice that keeps the user's draft — not a red history card.
      return { ...copy, render: "composer-notice", ...debug };

    case "unknown":
      return {
        kind: "unknown",
        title: "Something went wrong",
        description:
          "Langy hit an unexpected error. Try again, and if it keeps happening, share the details below with support.",
        render: "card",
        action: retry,
        traceId: domain.traceId,
        code: domain.code,
        ...debug,
      };

    default: {
      // A code with no registered copy: still useful, never a raw string, and
      // its meta + reasons are surfaced for debugging. Registered copy wins
      // whenever there is any — a Langy-adjacent code the switch above doesn't
      // name (`langy_empty_message`, `langy_credential_resolution`) is far
      // better served by its own entry than by the stock line.
      return {
        kind: domain.code,
        title: isRegistered ? title : "Langy couldn't finish that",
        // For an unregistered code this is the server-authored sentence the
        // registry lifted out of `meta.message` — the only channel carrying
        // prose (ADR-045), and how a proxied Go herr explains itself before we
        // write copy for its code.
        description:
          description ||
          "The request was rejected. Try rephrasing or start again.",
        render: "card",
        action: retry,
        traceId: domain.traceId,
        code: domain.code,
        ...debug,
      };
    }
  }
}
