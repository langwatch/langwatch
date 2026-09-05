/**
 * The pull-request card's data — and the ONE place that says where it comes from.
 */

/** The tool name the control plane records an opened PR under. */
export const LANGY_OPEN_PR_TOOL = "github.open_pr";

/** A PR's real state, flattened from GitHub's `state` + `draft` + `merged`. */
export type GithubPrState = "draft" | "open" | "merged" | "closed";

/**
 * What the card renders.
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

  const state = STATES.includes(pr.state as GithubPrState) ? (pr.state as GithubPrState) : "open";

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
    ...(num(pr.changedFiles) !== undefined ? { changedFiles: num(pr.changedFiles)! } : {}),
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
 */
export function githubPrsFromToolParts(parts: readonly ToolPart[]): GithubPrCardData[] {
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
