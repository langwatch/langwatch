// Refreshes the coding agent usage comment one last time, after a pull
// request has merged — the per-pull-request workflow only refreshes on a
// push, so tokens spent after the last push (e.g. review re-reads) are
// otherwise never reported. Runs on a push to the default branch and finds
// the pull requests that merged into it. Spec: specs/ci/pr-token-usage.feature

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { nextPageUrl, reportUsage } from "./pr-token-usage.ts";

/** A push whose `before` is all zeros created the branch: there is no range
 * to compare against, only the tip. */
const NO_PARENT = "0".repeat(40);

export type AssociatedPullRequest = {
  number: number;
  merged_at?: string | null;
  base?: { ref?: string } | null;
  head?: { repo?: { full_name?: string } | null } | null;
};

export type MergeTargets = { refresh: number[]; forks: number[] };

/**
 * GitHub associates a commit with every pull request that contains it, not
 * only the one that merged it. A pull request must have merged, merged INTO
 * the branch just pushed, and come from this repository (never a fork).
 */
export const mergeTargets = ({
  pullRequests,
  branch,
  repository,
}: {
  pullRequests: AssociatedPullRequest[];
  branch: string;
  repository: string;
}): MergeTargets => {
  const merged = pullRequests.filter(
    (pull) => Boolean(pull.merged_at) && (pull.base?.ref ?? "") === branch,
  );
  const isOwn = (pull: AssociatedPullRequest) => (pull.head?.repo?.full_name ?? "") === repository;
  const numbers = (list: AssociatedPullRequest[]) => [...new Set(list.map((pull) => pull.number))];
  return {
    refresh: numbers(merged.filter(isOwn)),
    forks: numbers(merged.filter((pull) => !isOwn(pull))),
  };
};

/**
 * The push tip alone is not the push: a merge queue empties a batch at once,
 * and a rebase merge lands each of a pull request's commits, so resolving
 * from the tip alone would miss every earlier pull request in the push.
 */
export const commitsToResolve = ({
  after,
  compared,
}: {
  after: string;
  compared: string[];
}): string[] => [...new Set([...compared, after])].filter(Boolean);

export type ResolvedCommit = {
  commit: string;
  pullRequests: AssociatedPullRequest[];
};

/**
 * Which commit each pull request landed on, so a push carrying several can
 * stamp each with its own. A rebase merge associates every commit with the
 * PR; the compare runs oldest first, so the LAST match is where it landed.
 */
export const landingCommits = (resolved: ResolvedCommit[]): Map<number, string> => {
  const landedOn = new Map<number, string>();
  for (const { commit, pullRequests } of resolved) {
    for (const pull of pullRequests) landedOn.set(pull.number, commit);
  }
  return landedOn;
};

const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

const fetchPushedCommits = async ({
  apiUrl,
  token,
  repository,
  before,
  after,
}: {
  apiUrl: string;
  token: string;
  repository: string;
  before: string;
  after: string;
}): Promise<string[]> => {
  if (!before || before === NO_PARENT || before === after) return [];
  let url: string | null =
    `${apiUrl}/repos/${repository}/compare/${before}...${after}?per_page=100`;
  const shas: string[] = [];
  while (url) {
    const response: Response = await fetch(url, {
      headers: githubHeaders(token),
    });
    // A force push leaves `before` unreachable and the compare 404s. The tip
    // is still a real commit, so fall back to it rather than fail the job.
    if (!response.ok) {
      console.log(
        `::warning title=pr-token-usage::Comparing ${before}...${after} ` +
          `answered ${response.status}; resolving the push tip alone`,
      );
      return [];
    }
    const page = (await response.json()) as { commits?: { sha: string }[] };
    shas.push(...(page.commits ?? []).map((commit) => commit.sha));
    url = nextPageUrl(response.headers.get("link"));
  }
  return shas;
};

const fetchAssociatedPullRequests = async ({
  apiUrl,
  token,
  repository,
  sha,
}: {
  apiUrl: string;
  token: string;
  repository: string;
  sha: string;
}): Promise<AssociatedPullRequest[]> => {
  const response = await fetch(`${apiUrl}/repos/${repository}/commits/${sha}/pulls?per_page=100`, {
    headers: githubHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Listing the pull requests for ${sha} failed with ${response.status}`);
  }
  return (await response.json()) as AssociatedPullRequest[];
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
};

const run = async (): Promise<void> => {
  const dryRun = process.argv.includes("--dry-run");
  const repository = requireEnv("PR_REPOSITORY");
  const sha = requireEnv("PUSH_SHA");
  const branch = requireEnv("PUSH_BRANCH");
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";
  const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const token = requireEnv("GITHUB_TOKEN");

  const commits = commitsToResolve({
    after: sha,
    compared: await fetchPushedCommits({
      apiUrl,
      token,
      repository,
      before: process.env.PUSH_BEFORE ?? "",
      after: sha,
    }),
  });

  const resolved: ResolvedCommit[] = [];
  for (const commit of commits) {
    resolved.push({
      commit,
      pullRequests: await fetchAssociatedPullRequests({
        apiUrl,
        token,
        repository,
        sha: commit,
      }),
    });
  }
  const landedOn = landingCommits(resolved);

  const { refresh, forks } = mergeTargets({
    pullRequests: resolved.flatMap((entry) => entry.pullRequests),
    branch,
    repository,
  });

  for (const prNumber of forks) {
    console.log(`${repository}#${prNumber} merged from a fork; skipping.`);
  }

  if (refresh.length === 0) {
    console.log(
      `${commits.length} commit(s) up to ${sha.slice(0, 7)} merged no pull ` +
        `request into ${branch}.`,
    );
    return;
  }

  for (const prNumber of refresh) {
    // The stamp names the merge commit rather than the pull request's head:
    // that is the commit this total is final as of.
    await reportUsage({
      repository,
      prNumber,
      shortSha: (landedOn.get(prNumber) ?? sha).slice(0, 7),
      endpoint,
      apiKey: requireEnv("LANGWATCH_API_KEY"),
      apiUrl,
      token,
      dryRun,
      final: true,
    });
  }
};

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  run().catch((error) => {
    // Even an unexpected failure only warns: see the non-blocking note above.
    console.log(`::warning title=pr-token-usage::${String(error)}`);
  });
}
