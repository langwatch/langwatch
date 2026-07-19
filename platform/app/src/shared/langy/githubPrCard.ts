/**
 * The pull-request card's data — and the ONE place that says where it comes from.
 *
 * A PR Langy opened reaches the browser as a durable TOOL PART
 * (`tool-github.open_pr`), whose output is this shape as JSON. The turn processor
 * writes it after `gh pr create` settles, enriched from the GitHub API; the panel
 * reads it back off the message.
 *
 * ── WHY A TOOL PART, AND NOT THE MODEL'S PROSE ─────────────────────────────
 *
 * The card used to be scraped out of the assistant's reply: any
 * `github.com/owner/repo/pull/N` URL in the text drew a PR card. That was the
 * LAST place in Langy's UI steered by regexing the model's text, and it had the
 * same three faults as the sentinels before it — the model could mangle the URL,
 * omit it, or merely MENTION a PR it had not opened and get a card for it.
 *
 * A tool part cannot lie: it is written by the control plane from the stdout of
 * the command that created the PR. It is persisted with the message, so the card
 * survives a refresh (the old prose card did not — sentinels were stripped before
 * persistence). And it carries structure, so the card can be a real PR card
 * rather than a link.
 *
 * Neutral module: the server writes this shape, the UI renders it, neither owns it.
 */

/** The tool name the control plane records an opened PR under. */
export const LANGY_OPEN_PR_TOOL = "github.open_pr";

/** A PR's real state, flattened from GitHub's `state` + `draft` + `merged`. */
export type GithubPrState = "draft" | "open" | "merged" | "closed";

/**
 * What the card renders.
 *
 * The first five fields are what we KNOW, always, from `gh pr create`'s own
 * stdout. Everything after them comes from the GitHub API and is OPTIONAL on
 * purpose: enrichment can fail for reasons that say nothing about the PR (an
 * expired token, a repo gone private, a rate limit), and when it does the card
 * must degrade to the truth we have rather than showing an error where a pull
 * request should be.
 */
export interface GithubPrCardData {
  owner: string;
  repo: string;
  number: number;
  url: string;
  state: GithubPrState;
  /** Enriched. Absent when the GitHub lookup failed. */
  title?: string;
  headRef?: string;
  baseRef?: string;
  author?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
}

const STATES: GithubPrState[] = ["draft", "open", "merged", "closed"];

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Parse a `github.open_pr` tool part's output. Null if it isn't one. */
export function parseGithubPrCard(output: unknown): GithubPrCardData | null {
  let raw: unknown = output;
  if (typeof output === "string") {
    try {
      raw = JSON.parse(output);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const pr = raw as Record<string, unknown>;

  const owner = str(pr.owner);
  const repo = str(pr.repo);
  const url = str(pr.url);
  const number = num(pr.number);
  // Without the identity there is no card. These four are exactly what stdout
  // guarantees, so a card that cannot produce them is not a PR we opened.
  if (!owner || !repo || !url || number === undefined) return null;

  const state = STATES.includes(pr.state as GithubPrState)
    ? (pr.state as GithubPrState)
    : "open";

  return {
    owner,
    repo,
    number,
    url,
    state,
    ...(str(pr.title) ? { title: str(pr.title)! } : {}),
    ...(str(pr.headRef) ? { headRef: str(pr.headRef)! } : {}),
    ...(str(pr.baseRef) ? { baseRef: str(pr.baseRef)! } : {}),
    ...(str(pr.author) ? { author: str(pr.author)! } : {}),
    ...(num(pr.additions) !== undefined ? { additions: num(pr.additions)! } : {}),
    ...(num(pr.deletions) !== undefined ? { deletions: num(pr.deletions)! } : {}),
    ...(num(pr.changedFiles) !== undefined
      ? { changedFiles: num(pr.changedFiles)! }
      : {}),
  };
}

/** A tool part on a streamed or persisted assistant message. */
interface ToolPart {
  type?: string;
  state?: string;
  output?: unknown;
}

/**
 * The PRs an assistant message opened, read off its tool parts.
 *
 * A part that ERRORED is skipped: a `gh pr create` that failed opened no PR, and
 * must never render as one that did. The prose card could not tell the
 * difference — a URL in the text looked the same either way.
 */
export function githubPrsFromToolParts(
  parts: readonly ToolPart[],
): GithubPrCardData[] {
  const prs: GithubPrCardData[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (part.type !== `tool-${LANGY_OPEN_PR_TOOL}`) continue;
    if (part.state === "output-error") continue;
    const pr = parseGithubPrCard(part.output);
    if (!pr) continue;
    const key = `${pr.owner}/${pr.repo}#${pr.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prs.push(pr);
  }
  return prs;
}
