import { GITHUB_AGENT_BRANCH_PREFIX } from "@langwatch/github-contract";
import { z } from "zod";

import type { GithubCheckRunSummary, GithubCheckSuiteSummary } from "../app/github.app.ts";

const repositoryRefSchema = z.object({ id: z.number() });

const githubCheckSuiteEventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.union([z.number(), z.string()]) }).nullish(),
  repository: z.object({
    id: z.number(),
    name: z.string().min(1),
    full_name: z.string().min(1),
    owner: z.object({ login: z.string().min(1) }),
  }),
  check_suite: z.object({
    head_branch: z.string().nullish(),
    head_sha: z.string().min(1),
    pull_requests: z
      .array(
        z.object({
          number: z.number().int().positive(),
          head: z.object({ ref: z.string(), repo: repositoryRefSchema }),
          base: z.object({ repo: repositoryRefSchema }),
        }),
      )
      .default([]),
  }),
});

/** A completed check suite on an agent branch, with the pull requests it belongs to. */
export type GithubAgentCheckSuiteCompleted = {
  installationId: string;
  repositoryId: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryFullName: string;
  headBranch: string;
  headSha: string;
  pullRequestNumbers: number[];
};

/**
 * The completed check suite worth asking GitHub about, or null. Only an agent branch on the
 * repository itself counts: a fork's pull request, a branch a person opened, or a suite that
 * is only requested is dropped before any call to GitHub.
 */
export function parseAgentCheckSuiteCompleted(
  payload: unknown,
): GithubAgentCheckSuiteCompleted | null {
  const parsed = githubCheckSuiteEventSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { action, installation, repository, check_suite: suite } = parsed.data;
  if (action !== "completed" || installation?.id == null) return null;
  const headBranch = suite.head_branch ?? "";
  if (!headBranch.startsWith(GITHUB_AGENT_BRANCH_PREFIX)) return null;

  const pullRequestNumbers = suite.pull_requests
    .filter(
      (pull) =>
        pull.head.ref === headBranch &&
        pull.head.repo.id === repository.id &&
        pull.base.repo.id === repository.id,
    )
    .map((pull) => pull.number);
  if (pullRequestNumbers.length === 0) return null;

  return {
    installationId: String(installation.id),
    repositoryId: String(repository.id),
    repositoryOwner: repository.owner.login,
    repositoryName: repository.name,
    repositoryFullName: repository.full_name,
    headBranch,
    headSha: suite.head_sha,
    pullRequestNumbers,
  };
}

const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const MAX_FAILED_CHECKS = 20;

/** What a commit's checks add up to once they all finished, or `running` while any still runs. */
type GithubCommitChecksVerdict =
  | { kind: "running" }
  | {
      kind: "finished";
      conclusion: "success" | "failure";
      failedChecks: { name: string; conclusion: string; url: string | null }[];
    };

/**
 * Whether every check on a commit finished, and how. A suite GitHub created for an app that
 * never ran anything stays queued forever, so a suite with no check runs is not waited for.
 */
export function judgeCommitChecks(input: {
  suites: readonly GithubCheckSuiteSummary[];
  runs: readonly GithubCheckRunSummary[];
}): GithubCommitChecksVerdict {
  const suites = input.suites.filter((suite) => suite.checkRunCount > 0);
  if (suites.some((suite) => suite.status !== "completed")) return { kind: "running" };
  if (input.runs.some((run) => run.status !== "completed")) return { kind: "running" };

  const failedChecks = input.runs
    .filter((run) => !PASSING_CONCLUSIONS.has(run.conclusion ?? ""))
    .map((run) => ({
      name: run.name,
      conclusion: run.conclusion ?? "unknown",
      url: run.detailsUrl,
    }));
  const suiteFailed = suites.some((suite) => !PASSING_CONCLUSIONS.has(suite.conclusion ?? ""));

  return {
    kind: "finished",
    conclusion: failedChecks.length > 0 || suiteFailed ? "failure" : "success",
    failedChecks: failedChecks.slice(0, MAX_FAILED_CHECKS),
  };
}
