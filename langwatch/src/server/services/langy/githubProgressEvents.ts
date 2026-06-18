/**
 * In-band progress events for the GitHub PR-opening flow.
 *
 * The worker (services/langy-agent) doesn't currently have a structured
 * channel back to the manager — it streams OpenCode SSE events that this
 * codebase opens as text deltas. Rather than invent a new wire protocol and
 * version-coordinate worker/manager, we ride the existing text channel:
 *
 *  - The `github.md` skill emits `[langy:progress:<stage>:<detail>]` lines
 *    as it runs (cloning, branching, committing, pushing).
 *  - This module parses those sentinels out of accumulated assistant text
 *    so the UI can render a steps card and the persisted message stays
 *    clean.
 *
 * v0 keeps stages a closed enum: anything else is dropped (logged once if a
 * skill drifts). Cheap, observable, no breaking changes to the worker.
 *
 * Spec: specs/assistant/langy-github-prs.feature. Issue: #4747.
 */

export type GithubProgressStage =
  | "cloning"
  | "cloned"
  | "branched"
  | "edited"
  | "committed"
  | "pushed"
  | "opening_pr"
  | "opened";

export type GithubProgressEvent = {
  stage: GithubProgressStage;
  detail?: string;
};

const STAGE_VALUES: GithubProgressStage[] = [
  "cloning",
  "cloned",
  "branched",
  "edited",
  "committed",
  "pushed",
  "opening_pr",
  "opened",
];

/**
 * Bounded to a single line — non-greedy `[^\]]*?` would still consume `\n`s if
 * it eventually finds a `]`, swallowing real prose between a typo'd opening
 * marker and the next bracket. The detail capture excludes both `]` AND `\n`.
 */
const PROGRESS_RE = /\[langy:progress:([a-z_]+)(?::([^\]\n]*?))?\]/g;

export type ProgressParse = {
  events: GithubProgressEvent[];
  /** Text with all `[langy:progress:...]` markers removed. */
  cleanedText: string;
};

export function parseGithubProgressEvents(text: string): ProgressParse {
  PROGRESS_RE.lastIndex = 0;
  const events: GithubProgressEvent[] = [];
  let m: RegExpExecArray | null;
  while ((m = PROGRESS_RE.exec(text)) !== null) {
    const [, stage, detail] = m;
    if (!stage || !isStage(stage)) continue;
    events.push(detail ? { stage, detail } : { stage });
  }
  PROGRESS_RE.lastIndex = 0;
  const cleanedText = text.replace(PROGRESS_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { events, cleanedText };
}

function isStage(value: string): value is GithubProgressStage {
  return (STAGE_VALUES as string[]).includes(value);
}
