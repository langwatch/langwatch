import {
  explainHandledError,
  type HandledErrorShape,
  readHandledError,
  UNKNOWN_ERROR_PRESENTATION,
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
  // place (ADR-078).
  //
  // For the refusals that are WAITS rather than turn failures — nothing broke
  // and nothing was lost, the message just cannot go yet: `langy_turn_in_progress`
  // ("one turn at a time per conversation") and `langy_rate_limited` (the
  // per-user message limit). Both resolve on their own with a few seconds'
  // patience, so neither gets a retry action, and neither may leave a red card
  // in the transcript claiming Langy is the thing at fault.
  | "composer-notice";

export interface LangyErrorAction {
  label: string;
  kind: "connect-github" | "configure-model" | "reconnect-codex" | "retry";
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
  // Sending faster than the per-user limit allows. Explicit copy matters more
  // here than almost anywhere: the generic default titles every unknown kind
  // "Langy couldn't finish that" and hands it a "Try again" button, which tells
  // a merely-throttled user the product is broken and then invites them to hit
  // the same limit again.
  "langy_rate_limited",
  // Codex (the sign-in-with-OpenAI provider): the OAuth session died and the
  // user must re-authenticate, or their ChatGPT plan's usage limit refused
  // the turn. Promoted off the agent-errored reason chain — see
  // promoteCodexAgentError. Spec: specs/model-providers/codex-account-provider.feature
  "langy_codex_session_expired",
  "langy_codex_plan_limit",
] as const;

/**
 * The gateway's typed codex failures ride the received reason chain of a
 * `langy_agent_errored` (herr ⇄ HandledError, one model across the wire).
 * Promote them to their own kinds by EXACT reason-code match — never by
 * sniffing message strings — so the panel renders the re-authenticate card /
 * the plan-limit explanation instead of a generic "reply failed".
 */
export function promoteCodexAgentError(
  domain: LangyDomainError,
): LangyDomainError {
  if (domain.code !== "langy_agent_errored") return domain;
  const flat: LangySerializedReason[] = [];
  const walk = (reasons?: LangySerializedReason[]) => {
    for (const reason of reasons ?? []) {
      flat.push(reason);
      walk(reason.reasons);
    }
  };
  walk(domain.reasons);
  if (flat.some((reason) => reason.kind === "codex_session_expired")) {
    return { ...domain, code: "langy_codex_session_expired" };
  }
  if (flat.some((reason) => PLAN_LIMIT_REASONS.has(reason.kind))) {
    return { ...domain, code: "langy_codex_plan_limit" };
  }
  return domain;
}

/**
 * The reason codes that mean the customer's OpenAI account has no allowance
 * left, in any of the shapes the backends spell it.
 *
 * `usage_limit_reached` / `codex_plan_limit` come from the Codex backend;
 * `insufficient_quota` / `billing_hard_limit_reached` are OpenAI's own API
 * codes for the same situation reached from the other direction (no credit, or
 * a hard billing cap). Codex runs on the customer's OpenAI account either way,
 * so `langy_codex_plan_limit`'s copy — wait for the reset, or raise the limit
 * with OpenAI — is the correct remediation for all four.
 *
 * The last two were added when the card stopped reciting the provider's
 * sentence. "Your credit balance is too low" was the single most useful thing
 * that relay ever carried, and it arrives as one of these codes; promoting them
 * keeps that meaning as copy we wrote instead of prose we forwarded.
 */
const PLAN_LIMIT_REASONS: ReadonlySet<string> = new Set([
  "usage_limit_reached",
  "codex_plan_limit",
  "insufficient_quota",
  "billing_hard_limit_reached",
]);

/**
 * The proxy's upstream-status reasons (llmproxy.go `upstreamReasonCodes`).
 * They say the call to the MODEL PROVIDER failed and which way, which is a
 * different fact from "Langy's reply failed" and carries a different next
 * step: wait out a rate limit, fix a credential, pick another model.
 *
 * `llm_upstream_error` already writes one sentence per group, so promoting to
 * it reuses that copy rather than restating it here.
 */
const UPSTREAM_PROVIDER_REASONS: ReadonlySet<string> = new Set([
  "upstream_stream_error",
  "upstream_bad_request",
  "upstream_unauthorized",
  "upstream_forbidden",
  "upstream_not_found",
  "upstream_timeout",
  "upstream_conflict",
  "upstream_unprocessable_entity",
  "upstream_rate_limited",
  "upstream_unavailable",
  "upstream_http_error",
]);

/**
 * A turn that died because the model provider refused the call reads as the
 * provider failure it was, not as a nameless "Langy hit an error".
 *
 * Same rule as `promoteCodexAgentError`: promote by EXACT reason-code match,
 * never by sniffing the provider's message. Runs after it, so the codex codes
 * keep their more specific cards.
 */
export function promoteUpstreamProviderError(
  domain: LangyDomainError,
): LangyDomainError {
  if (domain.code !== "langy_agent_errored") return domain;
  return hasReasonKind(domain.reasons, UPSTREAM_PROVIDER_REASONS)
    ? { ...domain, code: "llm_upstream_error" }
    : domain;
}

/** Does any reason in the chain, at any depth, carry one of these kinds? */
function hasReasonKind(
  reasons: LangySerializedReason[] | undefined,
  kinds: ReadonlySet<string>,
): boolean {
  for (const reason of reasons ?? []) {
    if (kinds.has(reason.kind)) return true;
    if (hasReasonKind(reason.reasons, kinds)) return true;
  }
  return false;
}

/*
 * `firstReasonMessage` used to live here: it walked the reason chain for the
 * first `meta.message` and the cards rendered it, on the grounds that the
 * langyagent proxy captures the model provider's own error text there and that
 * text is "safe to show".
 *
 * It is not. A provider's error body is written for whoever holds the key, and
 * for a mediated call that is LangWatch — OpenAI rejects a bad key with
 * `Incorrect API key provided: sk-proj-…`, so forwarding the sentence puts a
 * platform credential in the panel. Nor could a scrubber save it: matching
 * credential SHAPES only catches the shapes someone listed.
 *
 * `promoteCodexAgentError` above already had the right idea and the comment to
 * go with it — promote by EXACT reason-code match, never by sniffing message
 * strings. Everything the relay was carrying that a customer could act on is a
 * discriminant in `PLAN_LIMIT_REASONS`, and it now selects copy from the
 * registry. What is left is prose we cannot vouch for, so it is not rendered.
 */

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

/**
 * Resolve the domain error behind a LIVE turn failure. Three roads, in order:
 * a turn-START rejection carries it on the tRPC error (`error.data.error`); a
 * mid-turn failure rides the stream's terminal entry as a JSON message; and
 * when the stream itself died with no typed payload (a genuinely broken
 * connection), the turn's real, classified failure is usually already on the
 * DURABLE record: naming it beats a generic apology whose cause the server
 * knew all along. Only when all three come up empty does the caller fall back
 * to the unknown card.
 *
 * That fallback carries an EMPTY `meta`. `meta` is the client contract for a
 * code — the fields a card actually renders — not a scratchpad for debug
 * context, and the raw message is not a field: since #5984 a handled error's
 * wire message is only its code slug, so `{ error: error.message }` printed
 * `langy_agent_errored` under the card for anything handled and a stray
 * transport string for anything else. The caller logs the message instead (see
 * LangyPanel), which is where debug context belongs.
 */
export function resolveLiveTurnError({
  error,
  durableLastError,
}: {
  error: { message: string } & object;
  durableLastError: string | null | undefined;
}): LangyDomainError {
  return (
    readLangyTrpcError(error) ??
    readLangyStreamError(error.message) ??
    (durableLastError ? readLangyStreamError(durableLastError) : null) ?? {
      code: "unknown",
      meta: {},
      httpStatus: 500,
    }
  );
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
 * Codes Langy mints CLIENT-SIDE that the registry already answers for under
 * another name.
 *
 * `promoteCodexAgentError` renames the gateway's `codex_session_expired` so the
 * panel can hang a "Sign in to Codex" action off it — a rendering decision,
 * which is Langy's to make. The WORDS are still the registry's, and they are
 * filed under the code the registry knows, so the lookup is aliased rather than
 * the copy re-authored here. (`langy_codex_plan_limit` needs no alias: it is an
 * enumerated app code with its own registry entry.)
 */
const REGISTRY_CODE_ALIASES: Record<string, string> = {
  langy_codex_session_expired: "codex_session_expired",
};

/**
 * The registry's words for this code.
 *
 * `LangyDomainError` is the same shape with the remediation channel made
 * optional (a stream frame and a synthesised "unknown" have no fault or tips),
 * so the gaps are filled with the server-side defaults before asking. Reasons
 * are dropped: the registry never reads them, and Langy's parsed form is its
 * own.
 */
/**
 * A Langy reason carries only `kind`; the registry matches on `code` OR
 * `kind`, so the one name fills both. Nothing is read out of a reason except
 * membership of an enumerated set, so no upstream prose can ride along.
 *
 * Returns the mutable element array rather than the readonly one the shape
 * declares: a nested `reasons` field is `SerializedReason[]`, so the recursive
 * step has to produce that to build the chain. A caller reading the whole
 * result as readonly still works, since mutable widens to readonly.
 */
type RegistryReason = HandledErrorShape["reasons"][number];

function toRegistryReasons(
  reasons: LangySerializedReason[] | undefined,
): RegistryReason[] {
  return (reasons ?? []).map((reason) => ({
    code: reason.kind,
    kind: reason.kind,
    reasons: toRegistryReasons(reason.reasons),
  }));
}

function registryCopy(domain: LangyDomainError) {
  return explainHandledError({
    code: REGISTRY_CODE_ALIASES[domain.code] ?? domain.code,
    meta: domain.meta,
    httpStatus: domain.httpStatus,
    fault: domain.fault ?? "customer",
    tips: domain.tips ?? [],
    docsUrl: domain.docsUrl,
    traceId: domain.traceId,
    // The chain is passed on so an entry that varies its sentence on a reason
    // discriminant can do it (`llm_upstream_error` says which way the provider
    // failed). This is the sanctioned way for copy to vary on an upstream:
    // matching an enumerated code, never reading its message.
    reasons: toRegistryReasons(domain.reasons),
  });
}

/**
 * A failed history read that will NEVER succeed on its own.
 *
 * The conversation is gone, or it was never this reader's to continue. Nothing
 * about it self-heals: the 3s poll returns the same answer forever, and the only
 * way forward is the card's own instruction (start a new chat).
 *
 * The panel demotes a failed read to a quiet "showing the messages we last
 * loaded" line whenever the transcript is still on screen, which is right for a
 * blip and wrong for these: the reader would go on reading a conversation that
 * no longer exists, with no retry offered and no next step, indefinitely. So
 * these keep the column.
 *
 * The set is a DENYLIST, and deliberately: everything unrecognised is treated as
 * transient. Getting that polarity wrong the other way is the more expensive
 * mistake — an infrastructure code we have no bespoke copy for would replace a
 * streaming answer with a red card, which is exactly the regression the stale
 * path exists to prevent (see `LangyHistoryStaleRead.integration.test.tsx`).
 */
const TERMINAL_LANGY_HISTORY_READ_KINDS = new Set([
  "langy_conversation_not_found",
  "langy_conversation_not_owned",
]);

/** @see TERMINAL_LANGY_HISTORY_READ_KINDS */
function isTransientLangyHistoryReadFailure(kind: string): boolean {
  return !TERMINAL_LANGY_HISTORY_READ_KINDS.has(kind);
}

/**
 * May this failed history read be demoted to the panel's quiet "showing the
 * messages we last loaded" line, rather than owning the message column?
 *
 * Two conditions, and the second is the one that was missing. There has to be
 * something on screen worth protecting — a transcript, or a turn in flight,
 * which is content of its own — AND the failure has to be one that might go
 * away. A failure that never will is not a stale read; it is the answer.
 *
 * @see TERMINAL_LANGY_HISTORY_READ_KINDS
 */
export function isStaleLangyHistoryRead({
  presentation,
  hasContentOnScreen,
}: {
  presentation: LangyErrorPresentation | null;
  hasContentOnScreen: boolean;
}): boolean {
  return (
    !!presentation &&
    hasContentOnScreen &&
    isTransientLangyHistoryReadFailure(presentation.kind)
  );
}

export function explainLangyError(
  received: LangyDomainError,
): LangyErrorPresentation {
  const domain = promoteUpstreamProviderError(promoteCodexAgentError(received));
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

    case "langy_agent_errored": {
      // The agent reported its own failure — usually the model call was
      // rejected upstream. Nothing crashed and nothing was lost. Deterministic,
      // so no auto-retry — the user decides.
      //
      // The card used to splice the provider's own message in here. It no
      // longer does (see the note above), and the one case where that sentence
      // was worth having — an account with no allowance left — reaches this
      // switch as `langy_codex_plan_limit` instead, promoted by reason code in
      // `promoteCodexAgentError` and answered with copy we wrote. Anything
      // still landing on `langy_agent_errored` is a rejection we cannot name,
      // so the registry's line plus the trace id is the honest answer.
      return { ...copy, render: "card", action: retry, ...debug };
    }

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
      // A prerequisite, not a fault, and deterministic — the identical request
      // fails again — so this offers the setup action rather than a retry. The
      // allowlist is the only runnable-set gate: any model on it runs, so the
      // fix is setting or swapping the model. `meta.model` rides along so the
      // user sees which one was rejected.
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

    case "langy_codex_session_expired":
      // The stored OpenAI session could not be refreshed. A setup step, not a
      // fault: the fix is signing in again (the action opens the inline Codex
      // sign-in), or picking another configured model from the composer. The
      // words come from the registry under `codex_session_expired` — see
      // REGISTRY_CODE_ALIASES.
      return {
        ...copy,
        render: "card",
        action: { label: "Sign in to Codex", kind: "reconnect-codex" },
        ...debug,
      };

    case "langy_codex_plan_limit":
      // OpenAI's plan limit refused the turn. Deterministic until the window
      // resets, so the useful moves are waiting or switching models; retry is
      // still offered for after the reset.
      return { ...copy, render: "card", action: retry, ...debug };

    case "langy_turn_in_progress":
      // One turn at a time per conversation. A retry would just 409 again, so
      // there's no retry action — the answer is to wait for the reply to finish.
      // It is a WAIT, not a turn failure, so it rides above the composer as a
      // dismissable notice that keeps the user's draft — not a red history card.
      return { ...copy, render: "composer-notice", ...debug };

    case "langy_rate_limited":
      // Throttled, not broken. Nothing failed, nothing was lost, and the only
      // fix is a few seconds of patience — so there is no "Try again" action,
      // which would be an invitation to walk straight back into the limit.
      // Like `langy_turn_in_progress` this is a WAIT rather than a turn
      // failure, so it rides above the composer as a dismissable notice and
      // the draft the user tried to send stays in the field (ADR-078), instead
      // of a red history card that claims Langy is the thing at fault.
      return {
        kind: domain.code,
        title: "You're sending messages too quickly",
        description:
          "Send this again in a few seconds. Your message is still in the box.",
        render: "composer-notice",
        ...debug,
      };

    case "unknown":
      // NO `code`. `unknown` is the explainer's own "this was never a handled
      // error" discriminant, not a domain code, so printing it under the message
      // gives support and the reader the literal word "unknown" and nothing
      // else.
      //
      // The TITLE comes from the shared module (ADR-045) — a third Langy
      // wording of "something went wrong" would drift from the toast and the
      // inline alert, which is exactly the drift this file's docblock is about.
      //
      // The DESCRIPTION deliberately does NOT. The shared copy is
      // "We've been notified. Try again in a moment." — a different promise
      // from a trace-id handoff, and it is unconditional. Here the second
      // sentence has to be conditional: an untyped browser failure
      // (`Error("Failed to fetch")`) carries no trace id, and a card must not
      // promise details it is about to render nothing for. That behaviour is
      // pinned by `langyErrorExplainer.unit.test.ts`. If the shared module ever
      // grows a trace-id-aware description, collapse this back onto it.
      return {
        kind: "unknown",
        title: UNKNOWN_ERROR_PRESENTATION.title,
        description: domain.traceId
          ? "Langy hit an unexpected error. Try again, and if it keeps happening, share the id below with support."
          : "Langy hit an unexpected error. Try again.",
        render: "card",
        action: retry,
        traceId: domain.traceId,
        ...debug,
      };

    default: {
      // A code with no registered copy: still useful, never a raw string, and
      // its meta + reasons are surfaced for debugging. Registered copy wins
      // whenever there is any — a Langy-adjacent code the switch above doesn't
      // name (`langy_empty_message`, `langy_credential_resolution`) is far
      // better served by its own entry than by the stock line.
      //
      // Below that used to sit the reason chain's first message, one hop deeper
      // than the registry looks. That is precisely where a proxied Go herr
      // parks the PROVIDER's body, so this branch — the one handling codes
      // nobody has written copy for — was the most likely of all to render a
      // sentence no one at LangWatch had ever read. Removed; the stock line is
      // what an unnamed failure gets, alongside its trace id.
      return {
        kind: domain.code,
        title: isRegistered ? title : "Langy couldn't finish that",
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
