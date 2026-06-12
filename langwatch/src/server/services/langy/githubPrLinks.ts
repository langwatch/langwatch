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
    const key = `${owner}/${repo}#${numberStr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, repo, number: Number(numberStr), url });
  }
  return out;
}
