/**
 * Turning "Opened pull request #1" into a link.
 *
 * Langy names a pull request by its number, which is how people talk about
 * one. The panel had the number and no way through to it, in a panel that
 * links everything else.
 *
 * The URLs come from the turn's TOOL PARTS, never from the reply. On the
 * sandbox path the control plane records a `github.open_pr` part; on the local
 * path the developer's own `gh pr create` prints the URL on stdout, and the
 * shell call's output is persisted with the message. Both are machine-written.
 * A number Langy merely mentioned, with no tool call behind it, stays plain
 * text — the same rule the pull-request card follows.
 *
 * Spec: specs/langy/langy-github-prs.feature.
 */

import { githubPrsFromToolParts } from "~/shared/langy/githubPrCard";
import { pullRequestUrlsIn } from "~/shared/langy/githubPrUrl";

/** A tool part on a streamed or persisted assistant message. */
interface ToolPart {
  type?: string;
  state?: string;
  output?: unknown;
}

/**
 * Pull-request number → URL, for every pull request this message's tool calls
 * produced. A call that errored contributes nothing: a `gh pr create` that
 * failed opened no pull request, so there is nothing to link.
 */
export function pullRequestLinksFromToolParts(
  parts: readonly ToolPart[],
): Map<number, string> {
  const links = new Map<number, string>();

  for (const pr of githubPrsFromToolParts(parts)) {
    links.set(pr.number, pr.url);
  }

  for (const part of parts) {
    if (part.state === "output-error") continue;
    for (const pr of pullRequestUrlsIn(part.output)) {
      if (links.has(pr.number)) continue;
      links.set(pr.number, pr.url);
    }
  }

  return links;
}

/** A fenced or inline code span, which is never rewritten. */
const CODE_SPAN = /```[\s\S]*?```|`[^`\n]*`/g;

/**
 * A bare `#123`. Not preceded by a word character (so `issue#3` and a URL's
 * `#fragment` are left alone) and not already inside a markdown link label.
 */
const PR_REFERENCE = /(^|[^\w`[])#(\d+)\b/g;

/**
 * Link every `#N` in the prose that names a pull request the turn opened.
 *
 * Code spans are copied through untouched, and a number with no URL behind it
 * is left as it was.
 */
export function linkPullRequestReferences({
  text,
  links,
}: {
  text: string;
  links: Map<number, string>;
}): string {
  if (links.size === 0 || !text.includes("#")) return text;

  let out = "";
  let cursor = 0;
  for (const code of text.matchAll(CODE_SPAN)) {
    out += linkOutsideCode(text.slice(cursor, code.index), links) + code[0];
    cursor = code.index + code[0].length;
  }
  return out + linkOutsideCode(text.slice(cursor), links);
}

function linkOutsideCode(chunk: string, links: Map<number, string>): string {
  return chunk.replace(PR_REFERENCE, (whole, lead: string, digits: string) => {
    const url = links.get(Number(digits));
    return url ? `${lead}[#${digits}](${url})` : whole;
  });
}
