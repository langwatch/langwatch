/**
 * The `pull_request` webhook payload, validated down to the fields linkage
 * uses.
 *
 * This is the event that makes branch-to-pull-request linkage immediate. The
 * payload already carries the repository, the head ref and the whole pull
 * request, so nothing here calls GitHub back: the object under `pull_request`
 * is the same JSON the REST list endpoint returns, and it is normalised by the
 * REST path's own `toPullRequestSummary` rather than by a second reading of
 * GitHub's field names.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
import { z } from "zod";

import { toPullRequestSummary } from "./github.github-app-token.adapter";

/**
 * The actions that change something linkage stores, and nothing else.
 *
 *   opened / reopened      the pull request exists, or exists again: the
 *                          golden path, and the whole reason for this event.
 *   closed                 carries `merged_at`, so it is what turns a row from
 *                          open into merged or closed.
 *   edited                 the title is stored and rendered, and this is the
 *                          only event that changes it. (A pull request's HEAD
 *                          ref is immutable on GitHub; `edited` reports a base
 *                          change, which linkage does not key on.)
 *   ready_for_review /     the draft flag is stored and drawn, and these are
 *   converted_to_draft     the two events that flip it, in both directions.
 *   synchronize            new commits on the head branch. It changes no field
 *                          on its own, but it is the strongest evidence the
 *                          branch is alive, and applying it keeps the branch
 *                          inside the recheck sweep's activity window.
 *
 * Everything else GitHub sends for a pull request (labels, assignees, review
 * requests, milestones, auto-merge) changes nothing on the row and nothing on
 * the page, so it is acknowledged and dropped rather than costing a write per
 * label on a busy repository.
 */
export const LINKING_PULL_REQUEST_ACTIONS: ReadonlySet<string> = new Set([
  "opened",
  "reopened",
  "closed",
  "edited",
  "ready_for_review",
  "converted_to_draft",
  "synchronize",
]);

/**
 * Only the fields linkage reads. Unknown keys are dropped by zod, which is what
 * keeps a schema change on GitHub's side from turning into a parse failure.
 */
const githubPullRequestEventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.union([z.number(), z.string()]) }).nullish(),
  repository: z.object({
    name: z.string().min(1),
    full_name: z.string().min(1),
    owner: z.object({ login: z.string().min(1) }),
  }),
  pull_request: z.object({
    number: z.number(),
    html_url: z.string(),
    title: z.string(),
    state: z.string(),
    draft: z.boolean().optional(),
    merged_at: z.string().nullish(),
    closed_at: z.string().nullish(),
    created_at: z.string(),
    /**
     * Required, and validated as an instant rather than as any string,
     * because it is what orders one delivery against another. GitHub sends it
     * on every `pull_request` event and permits deliveries to arrive out of
     * order, so a delivery without a usable one cannot be placed in the
     * sequence and must not be allowed to overwrite a newer stored snapshot.
     * A value `new Date` cannot read would reach the store as an Invalid Date
     * and fail the write there, which is a worse place to find out.
     */
    updated_at: z.string().datetime({ offset: true }),
    user: z.object({ login: z.string().optional() }).nullish(),
    head: z.object({
      ref: z.string().min(1),
      repo: z.object({ full_name: z.string() }).nullish(),
    }),
  }),
});

/** A `pull_request` delivery, reduced to what the mapping service needs. */
export interface GithubPullRequestEvent {
  action: string;
  installationId: string;
  repositoryOwner: string;
  repositoryName: string;
  headBranch: string;
  pullRequest: ReturnType<typeof toPullRequestSummary>;
}

/**
 * Read a delivery, or `null` for one linkage cannot act on.
 *
 * Three things make it unusable, and all three are ordinary rather than
 * exceptional, so none of them throws:
 *
 *   - a payload that does not match the shape at all;
 *   - no installation id, so there is no organization to attribute it to;
 *   - a head branch living in a different repository from the pull request,
 *     which is a fork. The REST path asks `?head={owner}:{branch}` against the
 *     session's own repository and so can only ever find same-repository pull
 *     requests; letting the event write mappings that path can never produce
 *     would make the two disagree about the same branch.
 */
export function parseGithubPullRequestEvent(
  payload: unknown,
): GithubPullRequestEvent | null {
  const parsed = githubPullRequestEventSchema.safeParse(payload);
  if (!parsed.success) return null;

  const { action, installation, repository, pull_request: pull } = parsed.data;
  if (installation?.id == null) return null;

  const headRepository = pull.head.repo?.full_name;
  if (!headRepository) return null;
  if (headRepository.toLowerCase() !== repository.full_name.toLowerCase()) {
    return null;
  }

  return {
    action,
    installationId: String(installation.id),
    repositoryOwner: repository.owner.login,
    repositoryName: repository.name,
    headBranch: pull.head.ref,
    // The REST path's own normalisation, over the same JSON GitHub sends there.
    // Passed unwidened so the compiler catches drift between this schema and
    // the interface, rather than a cast hiding it.
    pullRequest: toPullRequestSummary(pull),
  };
}
