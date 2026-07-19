/**
 * Rich PR details, fetched by US — never narrated by the model.
 *
 * `gh pr create` prints one thing: the URL of the PR it just opened. That is
 * enough to identify the PR (owner / repo / number) and, crucially, it is the
 * command's own stdout, so it cannot be misremembered. From there the control
 * plane asks GitHub for the rest.
 *
 * ── WHY WE FETCH IT AND NOT THE AGENT ──────────────────────────────────────
 *
 * The obvious alternative was to have the skill run `gh pr view --json …` after
 * creating the PR, so the JSON arrives in the tool stream for free. It was
 * rejected, and the reason matters: `gh pr create` has no `--json`, so that
 * design needs the model to REMEMBER TO RUN A SECOND COMMAND. That is
 * model-cooperation-as-protocol — the exact trap this codebase has now removed
 * three times (`[langy:connect-github]`, `[langy:progress:...]`, and permit
 * accounting that trusted the model to retype a URL). We are not reintroducing
 * it in a new costume.
 *
 * We already hold the user's GitHub token (it is on the turn's credentials — the
 * same token the worker uses), and we already trustworthily hold the PR's
 * identity. So we call `GET /repos/{owner}/{repo}/pulls/{number}` ourselves.
 * Zero model cooperation, and it is RICHER than `gh pr view` would have handed
 * us: `additions` / `deletions` / `changed_files` only exist on the single-PR
 * endpoint, so this route gets the diff stat for free.
 *
 * ── FAILURE HONESTY ────────────────────────────────────────────────────────
 *
 * The enrichment can fail for reasons that have nothing to do with the PR: the
 * token expired, the repo went private, GitHub rate-limited us. None of those
 * mean "no PR". So this NEVER throws and NEVER blocks the turn — it returns null,
 * and the card degrades to what we actually know from stdout (the repo, the
 * number, the URL). A half-populated card, or an error where a pull request
 * should be, would be a lie about the thing the user just asked us to do.
 */
import type {
  GithubPrCardData,
  GithubPrState,
} from "~/shared/langy/githubPrCard";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:langy:github-pr-details");

const GITHUB_API = "https://api.github.com";

/**
 * Every field below is one GitHub actually returns on
 * `GET /repos/{owner}/{repo}/pulls/{number}` — nothing invented. The shape is
 * `GithubPrCardData` (shared with the UI, which renders it); enrichment simply
 * fills in its optional half.
 */

/** Long enough for a slow API, short enough not to hold the turn up. */
const PR_DETAILS_TIMEOUT_MS = 5_000;

/** GitHub's `state` is only open/closed; `draft` and `merged` refine it. */
function resolveState(pr: {
  state?: unknown;
  draft?: unknown;
  merged?: unknown;
  merged_at?: unknown;
}): GithubPrState {
  if (pr.merged === true || typeof pr.merged_at === "string") return "merged";
  if (pr.state === "closed") return "closed";
  if (pr.draft === true) return "draft";
  return "open";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Fetch a PR's details. Returns null on ANY failure — the caller falls back to
 * what stdout already told it.
 */
export async function fetchGithubPrDetails({
  token,
  owner,
  repo,
  number,
  url,
  fetchImpl,
}: {
  token: string;
  owner: string;
  repo: string;
  number: number;
  /** The URL from `gh pr create`'s stdout — the fallback if GitHub omits one. */
  url: string;
  fetchImpl?: typeof fetch;
}): Promise<GithubPrCardData | null> {
  const doFetch = fetchImpl ?? fetch;
  try {
    const response = await doFetch(
      `${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(PR_DETAILS_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      // A 401/403/404 here says nothing about whether the PR exists — only that
      // we could not read it just now. Log the status; never the token.
      logger.debug(
        { status: response.status, owner, repo, number },
        "could not enrich langy PR — falling back to the bare link",
      );
      void response.body?.cancel();
      return null;
    }

    const pr = (await response.json()) as Record<string, unknown>;
    const head = (pr.head ?? {}) as Record<string, unknown>;
    const base = (pr.base ?? {}) as Record<string, unknown>;
    const user = (pr.user ?? {}) as Record<string, unknown>;

    return {
      owner,
      repo,
      number,
      url: asString(pr.html_url) || url,
      title: asString(pr.title),
      state: resolveState(pr),
      headRef: asString(head.ref),
      baseRef: asString(base.ref),
      author: asString(user.login),
      additions: asNumber(pr.additions),
      deletions: asNumber(pr.deletions),
      changedFiles: asNumber(pr.changed_files),
    };
  } catch (error) {
    // Timeout, DNS, rate limit, malformed JSON — none of it means "no PR".
    logger.debug(
      { error, owner, repo, number },
      "failed to enrich langy PR — falling back to the bare link",
    );
    return null;
  }
}
