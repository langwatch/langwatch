// Refreshes the coding agent usage comment one last time, after a pull
// request has merged.
//
// The per-pull-request workflow refreshes on every push, which means the last
// comment a pull request carries describes the world as it was at its last
// commit. Work continues after that commit: review agents read the diff, ask
// for changes and re-read it, and a pull request that is approved as it stands
// never gets another push to trigger a refresh. Those tokens were spent on
// this pull request and belonged in its report, and nothing was going to put
// them there.
//
// A merge is the moment the total stops moving, so this runs on a push to the
// default branch, finds the pull requests that merged into it, and refreshes
// each one's comment a final time.
//
// Deliberately non-blocking, like the workflow it completes: a LangWatch
// outage logs a warning and exits 0, and a push carrying no merged pull
// request is a no-op rather than a failure.
//
// Spec: specs/ci/pr-token-usage.feature

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { reportUsage } from "./pr-token-usage.ts";

export type AssociatedPullRequest = {
  number: number;
  merged_at?: string | null;
  base?: { ref?: string } | null;
  head?: { repo?: { full_name?: string } | null } | null;
};

export type MergeTargets = { refresh: number[]; forks: number[] };

/** GitHub associates a commit with every pull request that contains it, not
 * only the one that merged it, so the list needs narrowing on three counts.
 *
 * A pull request must have merged, must have merged INTO the branch that was
 * just pushed, and must come from this repository. That last one keeps the
 * promise the per-pull-request workflow makes: fork pull requests are never
 * commented on, and a merge is not the moment to start.
 *
 * A push usually yields exactly one pull request. A batch merge yields
 * several, and a direct push to the branch yields none. */
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
  const isOwn = (pull: AssociatedPullRequest) =>
    (pull.head?.repo?.full_name ?? "") === repository;
  const numbers = (list: AssociatedPullRequest[]) => [
    ...new Set(list.map((pull) => pull.number)),
  ];
  return {
    refresh: numbers(merged.filter(isOwn)),
    forks: numbers(merged.filter((pull) => !isOwn(pull))),
  };
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
  const response = await fetch(
    `${apiUrl}/repos/${repository}/commits/${sha}/pulls?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Listing the pull requests for ${sha} failed with ${response.status}`,
    );
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

  const { refresh, forks } = mergeTargets({
    pullRequests: await fetchAssociatedPullRequests({
      apiUrl,
      token,
      repository,
      sha,
    }),
    branch,
    repository,
  });

  for (const prNumber of forks) {
    console.log(`${repository}#${prNumber} merged from a fork; skipping.`);
  }

  if (refresh.length === 0) {
    console.log(`${sha.slice(0, 7)} merged no pull request into ${branch}.`);
    return;
  }

  for (const prNumber of refresh) {
    // The stamp names the merge commit rather than the pull request's head:
    // that is the commit this total is final as of.
    await reportUsage({
      repository,
      prNumber,
      shortSha: sha.slice(0, 7),
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
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  run().catch((error) => {
    // Even an unexpected failure only warns: see the non-blocking note above.
    console.log(`::warning title=pr-token-usage::${String(error)}`);
  });
}
