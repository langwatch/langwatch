/**
 * Reading a pull request URL out of `gh pr create`'s stdout. Neutral module
 * on purpose: used from both `server/` and `features/`, and server code must
 * not import from the browser side.
 */

/** A pull request URL as GitHub prints it. */
const PULL_REQUEST_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)\b/g;

export interface PullRequestUrl {
  number: number;
  url: string;
}

/** Every pull request URL in a command's output, in the order printed (rarely just the URL). */
export function pullRequestUrlsIn(output: unknown): PullRequestUrl[] {
  if (typeof output !== "string") return [];
  const found: PullRequestUrl[] = [];
  for (const match of output.matchAll(PULL_REQUEST_URL)) {
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number)) continue;
    found.push({ number, url: match[0] });
  }
  return found;
}

/** The first pull request URL in a command's output, if it printed one. */
export function firstPullRequestUrlIn(output: unknown): string | undefined {
  return pullRequestUrlsIn(output)[0]?.url;
}
