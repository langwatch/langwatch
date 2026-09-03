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
import {
  LANGY_PROMPT_DEFAULT_TAG,
  type LangyPromptHandle,
} from "@langwatch/langy-contract";

const logger = createLogger("langwatch:langy:prompt-registry");

/** Narrow technical port over the external Prompt feature. */
export abstract class LangyPromptPort {
  abstract tryGetPromptByIdOrHandle(input: {
    idOrHandle: string;
    projectId: string;
    tag: string;
  }): Promise<{ prompt: string } | null>;
}

export interface ResolveLangyPromptParams {
  /** Only the read method is required — keeps this trivially fakeable in tests. */
  promptService: LangyPromptPort;
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
    const versioned = await promptService.tryGetPromptByIdOrHandle({
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
