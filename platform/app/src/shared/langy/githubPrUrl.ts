/**
 * Reading a pull request URL out of a command's own output.
 *
 * `gh pr create` prints the URL of the pull request it opened on stdout, and
 * the shell tool's output is persisted with the message. Two places read it:
 * the steps card's parser, so the opened step can link to the pull request, and
 * the reply rewriter, so "#12" in the prose becomes a link.
 *
 * Neutral module on purpose: the parser lives under `server/`, the rewriter
 * under `features/`, and server code must not import from the browser side.
 *
 * Spec: specs/langy/langy-github-prs.feature.
 */

/** A pull request URL as GitHub prints it. */
const PULL_REQUEST_URL =
  /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)\b/g;

export interface PullRequestUrl {
  number: number;
  url: string;
}

/**
 * Every pull request URL in a command's output, in the order it printed them.
 *
 * The output is rarely just the URL: `gh` prints warnings, and a chained
 * command prints the push's own lines first.
 */
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
