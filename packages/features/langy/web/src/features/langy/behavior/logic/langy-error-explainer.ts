import {
  explainHandledError,
  UNKNOWN_ERROR_PRESENTATION,
} from "@langwatch/handled-error/presentation";
import {
  type HandledErrorShape,
  readHandledError,
} from "@langwatch/handled-error/read-handled-error";

/**
 * Langy error explainer (ADR-045).
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
export interface LangyDomainError extends Omit<
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
 * The exact set of Langy-emittable handled `kind`s.
 */
export const KNOWN_LANGY_ERROR_KINDS = [
  "langy_conversation_not_found",
  "langy_conversation_not_owned",
  // Turn-execution failures (see the Langy server turn-error contract).
  "langy_agent_unavailable",
  "langy_agent_at_capacity",
  "langy_agent_session_lost",
  "langy_turn_timeout",
  "langy_worker_restarting",
  "langy_worker_spawn_failed",
  // The worker stopped mid-reply and the control plane exhausted its own recovery
  // — a FINAL state, not a client auto-retry. See langy-recovery-policy.ts.
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
  // see the Langy contract errors). These reach the browser as coded
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
  // The model selected for Langy has no credential this project can reach.
  // Promoted off the agent-errored reason chain — see
  // promoteModelUnavailableError.
  "langy_model_unavailable",
] as const;

/**
 * The gateway's typed codex failures ride the received reason chain of a
 * `langy_agent_errored` (herr ⇄ HandledError, one model across the wire).
 */
export function promoteCodexAgentError(domain: LangyDomainError): LangyDomainError {
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
 * The reason codes that mean the customer's OpenAI account has no allowance left, in
 * any of the shapes the backends spell it.
 */
const PLAN_LIMIT_REASONS: ReadonlySet<string> = new Set([
  "usage_limit_reached",
  "codex_plan_limit",
  "insufficient_quota",
  "billing_hard_limit_reached",
]);

/**
 * The proxy's upstream-status reasons (llmproxy.go `upstreamReasonCodes`).
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
 * A turn that died because the model provider refused the call reads as the provider
 * failure it was, not as a nameless "Langy hit an error".
 */
export function promoteUpstreamProviderError(domain: LangyDomainError): LangyDomainError {
  if (domain.code !== "langy_agent_errored") return domain;
  return hasReasonKind(domain.reasons, UPSTREAM_PROVIDER_REASONS)
    ? { ...domain, code: "llm_upstream_error" }
    : domain;
}

/**
 * The gateway's reasons for "this key cannot serve that model at all".
 */
const MODEL_UNAVAILABLE_REASONS: ReadonlySet<string> = new Set([
  "model_provider_not_bound",
  "model_not_recognized",
  "model_provider_disabled",
]);

/**
 * A turn that died because the chosen model is not reachable says so, and offers the
 * model settings.
 */
export function promoteModelUnavailableError(domain: LangyDomainError): LangyDomainError {
  if (domain.code !== "langy_agent_errored") return domain;
  return hasReasonKind(domain.reasons, MODEL_UNAVAILABLE_REASONS)
    ? { ...domain, code: "langy_model_unavailable" }
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
 * `firstReasonMessage` used to live here: it walked the reason chain for the first
 * `meta.message` and the cards rendered it, on the grounds that the langyagent proxy
 * captures the model provider's own error text there and that text is "safe to show".
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
export function readLangyStreamError(message: string | undefined | null): LangyDomainError | null {
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
    retryable?: unknown;
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
      value.meta && typeof value.meta === "object" ? (value.meta as Record<string, unknown>) : {},
    traceId: typeof value.traceId === "string" ? value.traceId : undefined,
    reasons: parseReasons(value.reasons),
    retryable: value.retryable === true,
  };
}

/**
 * Resolve the domain error behind a LIVE turn failure.
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
      retryable: false,
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
 * Codes Langy mints CLIENT-SIDE that the registry already answers for under another
 * name.
 */
const REGISTRY_CODE_ALIASES: Record<string, string> = {
  langy_codex_session_expired: "codex_session_expired",
};

/**
 * The registry's words for this code.
 */
type RegistryReason = HandledErrorShape["reasons"][number];

function toRegistryReasons(reasons: LangySerializedReason[] | undefined): RegistryReason[] {
  return (reasons ?? []).map((reason) => ({
    code: reason.kind,
    kind: reason.kind,
    // Langy's own parsed reason never carries a retryable flag (see
    // `LangySerializedReason`), and the registry does not read it off a
    // reason anyway — only off the top-level error.
    retryable: false,
    reasons: toRegistryReasons(reason.reasons),
  }));
}

function registryCopy(domain: LangyDomainError) {
  return explainHandledError({
    code: REGISTRY_CODE_ALIASES[domain.code] ?? domain.code,
    meta: domain.meta,
    httpStatus: domain.httpStatus,
    fault: domain.fault ?? "customer",
    retryable: domain.retryable,
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
 * May this failed history read be demoted to the panel's quiet "showing the messages we
 * last loaded" line, rather than owning the message column?
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
    !!presentation && hasContentOnScreen && isTransientLangyHistoryReadFailure(presentation.kind)
  );
}

export function explainLangyError(received: LangyDomainError): LangyErrorPresentation {
  // Order matters: the narrower promotions run first, so a codex session that
  // also carries an upstream status keeps its own card. "Not reachable at all"
  // is checked before "reached and refused" for the same reason.
  const domain = promoteUpstreamProviderError(
    promoteModelUnavailableError(promoteCodexAgentError(received)),
  );
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
      // re-dispatched it and it never came back).
      return { ...copy, render: "card", action: retry, ...debug };

    case "langy_agent_errored": {
      // The agent reported its own failure — usually the model call was rejected
      // upstream. Nothing crashed and nothing was lost. Deterministic, so no auto-retry
      // — the user decides.
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

    case "langy_model_unavailable":
      // A model IS chosen, and the project cannot serve it. Deterministic, so
      // the card offers the model settings rather than a retry that would fail
      // the same way. Sits beside `langy_model_not_configured`, which is the
      // other half: there nothing is chosen at all.
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
      // Throttled, not broken. Nothing failed, nothing was lost, and the only fix is a
      // few seconds of patience — so there is no "Try again" action, which would be an
      // invitation to walk straight back into the limit.
      return {
        kind: domain.code,
        title: "You're sending messages too quickly",
        description: "Send this again in a few seconds. Your message is still in the box.",
        render: "composer-notice",
        ...debug,
      };

    case "unknown":
      // NO `code`. `unknown` is the explainer's own "this was never a handled error"
      // discriminant, not a domain code, so printing it under the message gives support
      // and the reader the literal word "unknown" and nothing else.
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
      // A code with no registered copy: still useful, never a raw string, and its meta
      // + reasons are surfaced for debugging.
      return {
        kind: domain.code,
        title: isRegistered ? title : "Langy couldn't finish that",
        description: description || "The request was rejected. Try rephrasing or start again.",
        render: "card",
        action: retry,
        traceId: domain.traceId,
        code: domain.code,
        ...debug,
      };
    }
  }
}
