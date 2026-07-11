/**
 * PR URL extraction.
 *
 * Used by:
 *  - the turn processor, on `gh pr create`'s OWN STDOUT, to record the PRs a turn
 *    actually opened (the daily cap + the `langy.github.pr_opened` audit log).
 *  - the in-chat PR card, on the assistant's reply, to render one card per PR the
 *    answer mentions.
 *
 * The `extractOpenedPrLinks(text)` that used to sit here is GONE, and its removal
 * is a correctness fix. It decided which PRs a turn had opened by scanning the
 * model's PROSE for `[langy:progress:opened:...]` markers — so permit accounting
 * and the audit trail depended on an LLM retyping a URL accurately. A PR the
 * model mangled, truncated or forgot went uncounted. The processor now reads the
 * URL from the output of the command that created it, which cannot be
 * misremembered.
 *
 * Spec: specs/langy/langy-github-prs.feature. Issue: #4747.
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
    if (!owner || !repo || !numberStr) continue;
    const key = `${owner}/${repo}#${numberStr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, repo, number: Number(numberStr), url });
  }
  return out;
}
