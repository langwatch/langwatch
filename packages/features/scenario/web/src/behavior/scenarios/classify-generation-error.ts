/**
 * Decides which recovery a failed scenario generation offers — and nothing else.
 *
 * It used to decide the words too, by running a regex ladder over the error's
 * message (`/no default model/i`, `/rate limit/i`, …). That stopped working the
 * moment #5984 collapsed the wire message of a handled error to its code slug:
 * the ladder matched nothing, so every named failure the gateway reported
 * landed in the "unknown" tier and the modal printed the slug back at the
 * customer. The code was in our hands the whole time.
 *
 * So: the handled `code` picks the tier and the CTA, and the copy comes from
 * the code-keyed registry (`@langwatch/handled-error/presentation`). No copy is
 * authored here — a sentence written in this file is a sentence the registry
 * cannot keep consistent with the twenty other places the same code surfaces.
 */
import {
  type ErrorExplanation,
  explainAnyError,
  explainSerializedError,
} from "@langwatch/handled-error/presentation";
import { readHandledError } from "../errors";

import { ScenarioGenerationError } from "../../index";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** How the failure is grouped — what kind of thing went wrong. */
export type GenerationErrorTier = "config" | "auth" | "rate-limit" | "timeout" | "unknown";

/** Which recovery actions the surface offers. */
export type GenerationErrorCta = "configure" | "configure-and-retry" | "retry" | "retry-or-skip";

export interface GenerationErrorClass {
  tier: GenerationErrorTier;
  cta: GenerationErrorCta;
  /** Headline for the failure, from the registry. */
  title: string;
  /** Body copy, from the registry. Empty when the headline says it all. */
  copy: string;
  /**
   * The support handle, when the failure carried one — the only technical
   * detail that belongs in front of a customer (ADR-045).
   */
  traceId: string | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Classifier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The recovery a handled code deserves.
 *
 * Anything not listed falls to the unknown tier, whose "try again, or write it
 * yourself" is the honest offer when we can't say what would fix it.
 */
function recoveryFor(code: string | undefined): {
  tier: GenerationErrorTier;
  cta: GenerationErrorCta;
} {
  switch (code) {
    // Nothing will generate until a model provider is set up for this project,
    // so retrying is advice that cannot work.
    case "missing_provider":
    case "no_provider_configured":
    case "model_not_allowed":
    case "llm_model_not_set":
      return { tier: "config", cta: "configure" };

    // A credential the customer owns was refused. Same destination as `config`,
    // different reason — kept apart because the tier is what tests and future
    // surfaces branch on.
    case "invalid_api_key":
    case "virtual_key_revoked":
    case "codex_auth_failed":
    case "codex_session_expired":
    case "unauthorized":
      return { tier: "auth", cta: "configure" };

    // Waiting may be enough, and raising the ceiling lives in settings — so
    // offer both rather than picking one for them.
    case "rate_limited":
    case "budget_exceeded":
      return { tier: "rate-limit", cta: "configure-and-retry" };

    case "provider_timeout":
    case "idle_timeout":
      return { tier: "timeout", cta: "retry" };

    default:
      return { tier: "unknown", cta: "retry-or-skip" };
  }
}

/**
 * The words for a generation failure.
 *
 * `ScenarioGenerationError` is the endpoint's handled payload with the envelope
 * stripped off — `generateScenarioWithAI` parses `code` and `meta` out of
 * `domainError` and hangs them on a plain `Error` — so `readHandledError` can't
 * recognise it. Hand the registry the shape it does read rather than
 * re-deriving the copy here.
 */
function explain(error: unknown): ErrorExplanation {
  if (error instanceof ScenarioGenerationError) {
    return explainSerializedError({
      code: error.kind,
      kind: error.kind,
      meta: error.meta,
      httpStatus: 0,
      fault: "customer",
      retryable: false,
      traceId: undefined,
      spanId: undefined,
      reasons: [],
    });
  }
  return explainAnyError(error);
}

/**
 * The failure in the shape the APPLICATION's registry can read.
 *
 * `generateScenarioWithAI` calls a REST route and throws away the envelope:
 * `{ error: "<code>", ...meta }` becomes a plain `ScenarioGenerationError`
 * carrying `kind` and `meta`, which no boundary reader recognises. Handing that
 * to `ScenarioHostPort.failed` would resolve to the generic unknown line even
 * though the server named the failure. This puts the body back the way the
 * route sent it — a reconstruction, not an invention — so the registry answers.
 *
 * Anything else travels untouched: a tRPC failure already carries its envelope.
 */
export function reportableGenerationFailure(error: unknown): unknown {
  if (!(error instanceof ScenarioGenerationError)) return error;
  return { ...error.meta, error: error.kind };
}

/** Maps a generation failure to its tier, its recovery CTA and its copy. */
export function classifyGenerationError(error: unknown): GenerationErrorClass {
  const handled = readHandledError(error);
  const explanation = explain(error);
  const { tier, cta } = recoveryFor(
    error instanceof ScenarioGenerationError ? error.kind : handled?.code,
  );

  return {
    tier,
    cta,
    title: explanation.title,
    copy: explanation.description,
    traceId: handled?.traceId,
  };
}
