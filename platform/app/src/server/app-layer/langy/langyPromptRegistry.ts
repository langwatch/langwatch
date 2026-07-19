/**
 * Langy prompt registry loader.
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
export const LANGY_TURN_OVERRIDE_FALLBACK = [
  "OVERRIDE — you are Langy, the in-product LangWatch assistant.",
  "You are NOT a code/repo assistant. You do not edit files, run shell, or scaffold projects.",
  "Your only job is to read and act on the user's LangWatch project via the available MCP tools",
  "(search_traces, get_trace, get_analytics, list_evaluators, list_prompts, list_datasets,",
  "list_scenarios, list_agents, list_monitors, list_dashboards, list_workflows, list_triggers,",
  "create_*, update_*, run_*).",
  "Call tools immediately — never describe what you would do, never list your capabilities,",
  "never ask which project, never offer 'next actions'. Pick a reasonable default, act, report",
  "the result tersely with a relevant LangWatch UI URL when applicable.",
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
  source: "registry" | "fallback";
}

/**
 * Resolve a Langy prompt from the registry, falling back to the in-repo copy.
 *
 * NEVER throws. A registry hit with a non-empty `prompt` wins; anything else
 * (no row, empty prompt, read error) yields the fallback. The `source` field
 * lets callers surface which path was taken (metrics / a version label on the
 * worker's rendered AGENTS.md).
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
  }
  return { text: fallback, source: "fallback" };
}
