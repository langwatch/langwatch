/**
 * Reading a pull request URL out of `gh pr create`'s stdout. Neutral module
 * on purpose: used from both `server/` and `features/`, and server code must
 * not import from the browser side.
 */

/**
 * A pull request URL as GitHub prints it, on github.com or an Enterprise Server host
 * (GITHUB_LANGY_HOST), so the host is not fixed.
 */
const PULL_REQUEST_URL = /https:\/\/[\w.-]+(?::\d+)?\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\b/g;

export interface PullRequestUrl {
  number: number;
  url: string;
  /** `owner/repo`, as the URL spells it. */
  repositoryFullName: string;
}

/** Every pull request URL in a command's output, in the order printed (rarely just the URL). */
export function pullRequestUrlsIn(output: unknown): PullRequestUrl[] {
  if (typeof output !== "string") return [];
  const found: PullRequestUrl[] = [];
  for (const match of output.matchAll(PULL_REQUEST_URL)) {
    const number = Number(match[2]);
    if (!match[1] || !Number.isSafeInteger(number)) continue;
    found.push({ number, url: match[0], repositoryFullName: match[1] });
  }
  return found;
}

/** The first pull request URL in a command's output, if it printed one. */
export function extractFirstPullRequestUrl(output: unknown): string | undefined {
  return pullRequestUrlsIn(output)[0]?.url;
}
