/**
 * The pull-request usage wire shape, shared by the two doors that answer it:
 * the legacy personal-workspace route (`GET /api/coding-agent/pull-request-usage`)
 * and the v1 organization-key route
 * (`GET /api/v1/coding-agent/pull-request-usage`). One module so the published
 * schemas cannot drift apart — both doors answer the same rollup, and only the
 * credential that opens them differs.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { z } from "zod";

import { getGithubHost } from "~/server/app-layer/github/githubHost";

// The three cost numbers each row and the totals carry: what a bundled plan
// already covered, what is priced per token, and the list-price total of both.
// All three are null together for a project the caller may read but not price.
const costSplitShape = {
  costUsd: z.number().nullable(),
  billedCostUsd: z.number().nullable(),
  nonBilledCostUsd: z.number().nullable(),
};

// One contributor's line. A contributor is a project: a personal workspace is
// named by the person who owns it, a shared one by itself. There is no
// per-person split inside a shared project, because the only per-person key a
// session carries is an opaque id the agent reported about itself.
const usageRowSchema = z.object({
  projectId: z.string(),
  projectSlug: z.string(),
  contributorLabel: z.string(),
  contributorIsProject: z.boolean(),
  agent: z.string(),
  models: z.array(z.string()),
  sessionsCount: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
  totalTokens: z.number(),
  ...costSplitShape,
});

const modelUsageSchema = z.object({
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
  totalTokens: z.number(),
  costUsd: z.number().nullable(),
  /** False when only the model's name is known: the totals above are not real. */
  tokensKnown: z.boolean(),
});

export const pullRequestUsageResponseSchema = z.object({
  pullRequest: z.object({
    repositoryHost: z.string(),
    repositoryFullName: z.string(),
    prNumber: z.number(),
    headBranch: z.string(),
    htmlUrl: z.string(),
    state: z.string(),
    isDraft: z.boolean(),
    authorLogin: z.string().nullable(),
    prCreatedAtMs: z.number(),
    prClosedAtMs: z.number().nullable(),
    prMergedAtMs: z.number().nullable(),
  }),
  rows: z.array(usageRowSchema),
  totals: z.object({
    sessionsCount: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
    totalTokens: z.number(),
    ...costSplitShape,
  }),
  modelBreakdown: z.array(modelUsageSchema),
});

export const pullRequestUsageQuerySchema = z.object({
  /** "owner/name". Case is folded by the mapping store, so either works. */
  repository: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/, {
      message: "repository must be owner/name",
    })
    .describe('The repository as "owner/name".'),
  pullRequest: z.coerce
    .number()
    .int()
    .positive()
    .describe("The pull request number."),
  /**
   * Defaults to the GitHub host this instance is bound to, which is github.com
   * unless an operator named an Enterprise Server. The published document
   * states github.com, which is the default every instance has until it names
   * another host.
   */
  host: z
    .string()
    .min(1)
    .default(() => getGithubHost())
    .describe(
      "The GitHub host. Defaults to this instance's configured GitHub host, which is github.com unless an operator named a GitHub Enterprise Server.",
    ),
});
