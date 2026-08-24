/**
 * Langy prompt registry loader.
 *
 * WIRED for the per-turn override only. `langy-turn.service.ts` resolves the
 * system block through `resolveLangyPrompt` when LANGY_PROMPT_PROJECT_ID names
 * the project holding these rows; unset skips the registry entirely and the
 * in-repo fallback is used verbatim. The `agentDefinition` handle still has no
 * runtime consumer — the manager writes its embedded AGENTS.md — so seeding
 * that one changes nothing yet.
 *
 * Langy has two prompt surfaces we want stored as VERSIONED rows in LangWatch's
 * own prompt registry (`LlmPromptConfig`), rather than hardcoded:
 *
 *  1. The AGENTS.md agent-definition rules doc — today embedded in the manager
 *     binary (`services/langyagent/internal/assets/AGENTS.md`) and written to
 *     each worker's `$HOME/AGENTS.md`.
 *  2. The per-turn `system` override block — today the `LANGY_TURN_OVERRIDE_FALLBACK`
 *     constant below, composed in `langy-turn.service.ts` and sent to the manager
 *     `/chat` as the turn's `system` field.
 *
 * This module is the single seam that reads a Langy prompt from the registry
 * with a HARD FALLBACK to the in-repo copy. The invariant is: **Langy must never
 * fail to start a turn because a prompt row is missing, malformed, or the
 * registry read threw.** `resolveLangyPrompt` therefore never rejects — on any
 * miss/empty/error it returns the caller-supplied fallback and logs at warn.
 *
 * The registry read is a DIRECT service call (Prisma) — NOT an HTTP/tRPC call and
 * NOT the langwatch SDK — so it needs no `LANGWATCH_API_KEY` and does not touch
 * the platform self-reference guard (`langwatchPlatformGuard.ts`).
 *
 * WHERE the row lives is a deployment decision (see ADR-050): a prompt row
 * requires a `projectId` + `organizationId`, and there is no global/system
 * prompt scope. The caller passes the resolved `projectId` of the internal
 * "LangWatch system" project that holds these rows; when that is not configured
 * the caller skips the registry entirely and the fallback is used verbatim, so
 * behaviour is byte-identical to today until an operator opts in.
 */

import { createLogger } from "@langwatch/observability";
import type { PromptService } from "~/server/prompt-config/prompt.service";

const logger = createLogger("langwatch:langy:prompt-registry");

/**
 * Well-known handle SLUGS for Langy's registry prompts. Stored org-scoped, so the
 * fully-qualified handle the registry persists is `{organizationId}/{slug}` and
 * every project in the holding org can read it (see the ORGANIZATION scope branch
 * in `LlmConfigRepository.getConfigByIdOrHandleWithLatestVersion`). `getPromptByIdOrHandle`
 * qualifies a bare slug with the caller's org/project context, so these bare
 * slugs are what both the seed and the loader use.
 */
export const LANGY_PROMPT_HANDLES = {
  /** The AGENTS.md agent-definition rules doc (the "AGENT.md" of the ask). */
  agentDefinition: "langy-agent-definition",
  /** The per-turn control-plane system override block. */
  turnOverride: "langy-turn-override",
} as const;

export type LangyPromptHandle =
  (typeof LANGY_PROMPT_HANDLES)[keyof typeof LANGY_PROMPT_HANDLES];

/**
 * The default tag the loader pins to. Production reads should follow the
 * `production` tag so a new registry version is not live until it is promoted;
 * `latest` (the virtual tag) would make every draft edit immediately live.
 */
export const LANGY_PROMPT_DEFAULT_TAG = "production";

/**
 * The per-turn `system` override — Langy's role framing, prepended to the turn's
 * context block. This is the in-repo SOURCE OF TRUTH and the loader's fallback
 * for `LANGY_PROMPT_HANDLES.turnOverride`. Kept here (not in the turn service) so
 * the loader, the seed script, and the turn service all read the exact same
 * bytes — no drift between what we seed as version 1 and what we fall back to.
 */
/**
 * This block rides the per-message `system` field, appended AFTER AGENTS.md in
 * the assembled prompt. It exists as the operator's hot-patch channel: promote
 * a new `langy-turn-override` registry version and the wording changes without
 * a deploy. The worker already carries the persona twice (the build agent's
 * config prompt and AGENTS.md), so the default stays at three lines: repeating
 * the operating rules here made the model read the same commandments three
 * times, and any drift between the copies became a contradiction it had to
 * arbitrate.
 *
 * The rules kept here are the measured defects, because last position in the
 * prompt is the right place to spend on them. Grounding: in production, 40% of
 * turns that reach `status: "completed"` make zero tool calls, so the answer
 * came from the model rather than from the project. Ending: on the pi harness
 * the model closes replies with a next-actions question, which AGENTS.md bans;
 * mid-prompt the ban loses to the model's own habit, so the pointer rides
 * here.
 */
export const LANGY_TURN_OVERRIDE_FALLBACK = [
  "You are Langy, the in-product LangWatch assistant.",
  "AGENTS.md is your operating contract and applies to every reply.",
  "Facts about the user's project come from what you retrieve this turn, never from memory.",
  "End on the answer: no closing question or next-actions menu (AGENTS.md names the exceptions).",
].join(" ");

export interface ResolveLangyPromptParams {
  /** Only the read method is required — keeps this trivially fakeable in tests. */
  promptService: Pick<PromptService, "getPromptByIdOrHandle">;
  /** The project that HOLDS the Langy registry rows (the internal system project). */
  projectId: string;
  /** One of `LANGY_PROMPT_HANDLES`. */
  handle: LangyPromptHandle;
  /** In-repo copy used verbatim on any miss/empty/error. Never allowed to be empty. */
  fallback: string;
  /** Tag to pin (defaults to `production`); pass `"latest"` to read the newest draft. */
  tag?: string;
}

export interface ResolvedLangyPrompt {
  text: string;
  /**
   * Which path produced `text`:
   *
   *  - `registry` — a promoted row was read.
   *  - `fallback` — a GENUINE miss: no row, or a row whose prompt is empty.
   *    An operator demoting or deleting the row is deliberate, so the in-repo
   *    copy is the right answer.
   *  - `error`    — the read FAILED (Prisma timeout, connection blip). The
   *    text is the fallback because the caller must be handed something, but
   *    the distinction matters: a caller composing a per-conversation prefix
   *    can hold its last good text rather than swap the model's instructions
   *    mid-conversation over a transient failure. See
   *    `resolveLangyTurnOverride` in `langy-turn.service.ts`.
   */
  source: "registry" | "fallback" | "error";
}

/**
 * Resolve a Langy prompt from the registry, falling back to the in-repo copy.
 *
 * NEVER throws. A registry hit with a non-empty `prompt` wins; anything else
 * (no row, empty prompt, read error) yields the fallback text, with `source`
 * telling a miss apart from a failure so callers can treat them differently
 * and surface which path was taken (metrics / a span attribute / a version
 * label on the worker's rendered AGENTS.md).
 */
export async function resolveLangyPrompt(
  params: ResolveLangyPromptParams,
): Promise<ResolvedLangyPrompt> {
  const { promptService, projectId, handle, fallback } = params;
  const tag = params.tag ?? LANGY_PROMPT_DEFAULT_TAG;

  try {
    const versioned = await promptService.getPromptByIdOrHandle({
      idOrHandle: handle,
      projectId,
      tag,
    });
    const text = versioned?.prompt?.trim();
    if (text) {
      return { text: versioned!.prompt, source: "registry" };
    }
    logger.warn(
      { handle, projectId, tag },
      "langy prompt registry row missing or empty — using in-repo fallback",
    );
  } catch (error) {
    logger.warn(
      { error, handle, projectId, tag },
      "langy prompt registry read failed — using in-repo fallback",
    );
    return { text: fallback, source: "error" };
  }
  return { text: fallback, source: "fallback" };
}
