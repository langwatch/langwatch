import {
  type HandledErrorShape,
  readHandledError,
} from "~/features/automations/logic/errorExplainer";

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
 * Copy is keyed on an EXACT, static list of known `kind`s — never a heuristic
 * match on the string — so a new backend kind lands in the explicit generic
 * default (with its `meta` + `reasons` surfaced for debugging) rather than
 * being silently pattern-matched into the wrong bucket. `unknown` (unhandled)
 * gets one calm generic message plus a trace id.
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

/** Richer than the automations shape: also carries trace id + reason chain. */
export interface LangyDomainError extends HandledErrorShape {
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
  if (
    flat.some(
      (reason) =>
        reason.kind === "usage_limit_reached" ||
        reason.kind === "codex_plan_limit",
    )
  ) {
    return { ...domain, code: "langy_codex_plan_limit" };
  }
  return domain;
}

/**
 * The first server-authored prose message in the error's reason chain
 * (depth-first). `meta.message` is the ADR-045 prose channel: the langyagent
 * proxy captures the model provider's own error text there when a mediated
 * LLM call fails (llmproxy.go), and the platform serializers carry it through
 * — so this is the "credit balance too low" the user actually needs to see.
 */
export function firstReasonMessage(
  reasons: LangySerializedReason[] | undefined,
): string | null {
  for (const reason of reasons ?? []) {
    const message = reason.meta?.message;
    if (typeof message === "string" && message.length > 0) return message;
    const nested = firstReasonMessage(reason.reasons);
    if (nested) return nested;
  }
  return null;
}

/** Ends a provider message with terminal punctuation so copy can follow it. */
function asSentence(message: string): string {
  return /[.!?…]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`;
}

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
  const serialized = (
    err as {
      data?: {
        error?: { traceId?: unknown; reasons?: unknown };
      };
    }
  )?.data?.error;
  const traceId = serialized?.traceId;
  return {
    ...domain,
    traceId: typeof traceId === "string" ? traceId : undefined,
    reasons: parseReasons(serialized?.reasons),
  };
}

export function explainLangyError(
  received: LangyDomainError,
): LangyErrorPresentation {
  const domain = promoteCodexAgentError(received);
  // Always carried through for debugging, regardless of the matched case.
  const debug = {
    meta: Object.keys(domain.meta).length > 0 ? domain.meta : undefined,
    reasons: domain.reasons,
  };

  switch (domain.code) {
    case "langy_conversation_not_found":
      return {
        kind: domain.code,
        title: "Conversation not found",
        description:
          "This conversation is no longer available. Start a new chat to keep going.",
        render: "card",
        ...debug,
      };

    case "langy_conversation_not_owned":
      return {
        kind: domain.code,
        title: "This conversation belongs to someone else",
        description:
          "You can view shared conversations but only the owner can continue them.",
        render: "card",
        ...debug,
      };

    case "langy_agent_unavailable":
      return {
        kind: domain.code,
        title: "Langy is unavailable",
        description:
          "Langy can't be reached right now. Your message is safe — send it again in a moment.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_agent_at_capacity":
      return {
        kind: domain.code,
        title: "Langy is busy right now",
        description:
          "Too many conversations are running at once. Give it a few seconds and try again.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_agent_session_lost":
      return {
        kind: domain.code,
        title: "Langy lost its place",
        description:
          "Langy dropped this conversation before the reply finished. Send your message again to pick it back up.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_turn_timeout":
      return {
        kind: domain.code,
        title: "That took too long",
        description:
          "Langy didn't finish in time. Try again, or ask for a narrower slice — a shorter time range or a single trace.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_worker_stopped":
      // The worker stopped mid-reply (its process died, or the liveness sweep
      // re-dispatched it and it never came back). A FINAL state: the control plane
      // already exhausted its recovery, so this offers a manual "Try again" but is
      // never auto-retried — re-driving would only walk into the same dead worker,
      // which is exactly the flicker this replaced. Nothing was lost: the user's
      // message is on record, so retrying is safe, it is just their call.
      return {
        kind: domain.code,
        title: "Langy's worker stopped",
        description:
          "Langy's worker stopped before it could finish. Nothing you did is wrong and your message is safe — try again.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_agent_errored": {
      // The agent reported its own failure — usually the model call was
      // rejected upstream. Honest copy: the reply failed; nothing crashed and
      // nothing was lost. Deterministic, so no auto-retry — the user decides.
      //
      // When the reason chain carries the provider's own message (captured by
      // the langyagent LLM proxy — provider-facing text, safe to show), the
      // card says it: "Something went wrong" for an out-of-credits account is
      // unactionable, the provider's sentence is the whole fix.
      const providerMessage = firstReasonMessage(domain.reasons);
      return {
        kind: domain.code,
        title: "Langy's reply failed",
        description: providerMessage
          ? `The model provider rejected this reply: ${asSentence(providerMessage)} Your message is safe. Try again, or pick a different model from the composer.`
          : "Langy hit an error while writing this reply. Your message is safe — try again.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };
    }

    case "langy_worker_spawn_failed":
      // The manager tried to start a worker for this turn and it never came up.
      // Nothing the user did is wrong and nothing is lost — their message is on
      // record — so this reads as a hiccup with a retry, not a fault.
      return {
        kind: domain.code,
        title: "Langy couldn't start up",
        description:
          "Langy failed to get going for this reply. Nothing was lost — try again in a moment.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_worker_restarting":
      return {
        kind: domain.code,
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
        kind: domain.code,
        title: "Install the GitHub App to continue",
        description:
          "Langy needs the LangWatch GitHub App installed to open pull requests.",
        render: "suppress",
        action: { label: "Install GitHub App", kind: "connect-github" },
        ...debug,
      };

    case "langy_github_repo_not_accessible":
      // GitHub access exists; the specific repository isn't covered by the app
      // installation. Deterministic — the identical request 404s identically —
      // so no retry: the fix is granting the app access to that repository on
      // GitHub (Settings → Integrations → Configure deep-links there).
      return {
        kind: domain.code,
        title: "That repository isn't available to Langy",
        description:
          "The LangWatch GitHub App doesn't have access to that repository. " +
          "Grant it access from Settings → Integrations → Configure, then try again.",
        render: "card",
        ...debug,
      };

    case "langy_model_not_configured":
      // A prerequisite, not a fault: retrying the same send won't help until a
      // model is set, so this offers the setup action instead of a retry.
      return {
        kind: domain.code,
        title: "Choose a model for Langy",
        description:
          "Langy needs a model to run. Pick one in your project's model settings, then try again.",
        render: "card",
        action: { label: "Configure model", kind: "configure-model" },
        ...debug,
      };

    case "langy_model_not_allowed":
      // Deterministic — the identical request fails again — so no retry. The
      // allowlist is the only runnable-set gate: any model on it runs, so the
      // fix is picking an allowed model or changing the configuration.
      return {
        kind: domain.code,
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
        kind: domain.code,
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
        kind: domain.code,
        title: "Langy doesn't have access here",
        description:
          "Langy doesn't have the permissions it needs in this project. Ask a workspace admin to grant them.",
        render: "card",
        ...debug,
      };

    case "langy_codex_session_expired":
      // The stored OpenAI session could not be refreshed. A setup step, not a
      // fault: the fix is signing in again (the action opens the inline Codex
      // sign-in), or picking another configured model from the composer.
      return {
        kind: domain.code,
        title: "Your OpenAI session expired",
        description:
          "Codex runs on your OpenAI account, and its sign-in has expired. Sign in again to keep using it, or pick another model from the composer.",
        render: "card",
        action: { label: "Sign in to Codex", kind: "reconnect-codex" },
        ...debug,
      };

    case "langy_codex_plan_limit":
      // OpenAI's plan limit refused the turn. Deterministic until the window
      // resets, so the useful moves are waiting or switching models; retry is
      // still offered for after the reset.
      return {
        kind: domain.code,
        title: "Your OpenAI plan hit its usage limit",
        description:
          "Codex usage counts against your ChatGPT plan, and OpenAI says the limit is reached for now. Pick another model from the composer to keep going, or try again after the limit resets.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        ...debug,
      };

    case "langy_turn_in_progress":
      // One turn at a time per conversation. A retry would just 409 again, so
      // there's no retry action — the answer is to wait for the reply to finish.
      // It is a WAIT, not a turn failure, so it rides above the composer as a
      // dismissable notice that keeps the user's draft — not a red history card.
      return {
        kind: domain.code,
        title: "Langy is still replying",
        description:
          "There's already a response in progress for this conversation. Wait for it to finish before sending another message.",
        render: "composer-notice",
        ...debug,
      };

    case "unknown":
      return {
        kind: "unknown",
        title: "Something went wrong",
        description:
          "Langy hit an unexpected error. Try again — if it keeps happening, share the details below with support.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        traceId: domain.traceId,
        code: domain.code,
        ...debug,
      };

    default: {
      // A handled kind we don't have bespoke copy for yet: still useful, never
      // a raw string, and its meta + reasons are surfaced for debugging. A
      // server-authored sentence in `meta.message` wins over the stock line —
      // that is the only channel carrying prose (ADR-045), and it is how a
      // proxied Go herr explains itself before we write copy for its code.
      // The reason chain's first message is the fallback: the same channel,
      // one hop deeper.
      const authored = domain.meta?.message;
      const authoredText =
        typeof authored === "string" && authored.length > 0
          ? authored
          : firstReasonMessage(domain.reasons);
      return {
        kind: domain.code,
        title: "Langy couldn't finish that",
        description:
          authoredText ??
          "The request was rejected. Try rephrasing or start again.",
        render: "card",
        action: { label: "Try again", kind: "retry" },
        traceId: domain.traceId,
        code: domain.code,
        ...debug,
      };
    }
  }
}
