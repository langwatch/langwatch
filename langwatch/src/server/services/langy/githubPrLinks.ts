/**
 * PR URL extraction for assistant replies.
 *
 * Used by:
 *  - the chat handler post-stream, to count PRs against the per-user daily cap
 *    ({@link recordLangyGithubPr})
 *  - the in-chat PR card, to render one card per unique PR URL
 *
 * Lives under server/services/langy so both the route and the React component
 * can import the same pure function without dragging React or Chakra into the
 * server bundle.
 *
 * Spec: specs/assistant/langy-github-prs.feature. Issue: #4747.
 */

import { parseGithubProgressEvents } from "./githubProgressEvents";

export type GithubPrLink = {
  owner: string;
  repo: string;
  number: number;
  url: string;
};

const PR_URL_RE =
  /https?:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)\b/g;

export function extractGithubPrLinks(text: string): GithubPrLink[] {
  const seen = new Set<string>();
  const out: GithubPrLink[] = [];
  // exec needs a fresh lastIndex per call — the regex object is shared but we
  // reset before each loop so this stays reentrant.
  PR_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PR_URL_RE.exec(text)) !== null) {
    const [url, owner, repo, numberStr] = m;
    if (!owner || !repo || !numberStr) continue;
    const key = `${owner}/${repo}#${numberStr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, repo, number: Number(numberStr), url });
  }
  return out;
}

/**
 * PR links the assistant actually OPENED this turn — not ones it merely
 * mentioned. Used for the daily PR cap and the `langy.github.pr_opened`
 * audit log: counting every github.com/pull URL in prose lets "summarize PR
 * #4751" twenty times exhaust the cap and forge audit entries.
 *
 * Hard contract: returns ONLY links the github.md skill explicitly marked
 * with a `[langy:progress:opened:<owner>/<repo>#<n>]` sentinel. With no
 * progress events at all → return `[]`. The skill is pinned in this PR so
 * its sentinels are always present on actual PR creation; the previous
 * "fall back to every link when no events" branch was a footgun (a
 * read-only chat summarising 20 PRs forged 20 audit rows + burned the
 * daily cap). Sergio caught this on 2026-06-30 review round 3.
 */
export function extractOpenedPrLinks(text: string): GithubPrLink[] {
  const links = extractGithubPrLinks(text);
  const { events } = parseGithubProgressEvents(text);
  if (events.length === 0) return [];

  const openedDetails = events
    .filter((e) => e.stage === "opened")
    .map((e) => e.detail)
    .filter((d): d is string => Boolean(d));
  // `opened` fired but the detail didn't survive (skill drift) — fall back
  // to every link rather than undercount a real PR. Bounded: this branch
  // only fires when the skill emitted at least one `opened` event, so a
  // pure mention-summary turn never reaches it.
  if (openedDetails.length === 0) {
    return events.some((e) => e.stage === "opened") ? links : [];
  }
  const opened = new Set(openedDetails.map((d) => d.trim().toLowerCase()));
  return links.filter((l) =>
    opened.has(`${l.owner}/${l.repo}#${l.number}`.toLowerCase()),
  );
}
