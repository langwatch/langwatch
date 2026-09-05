/**
 * The pull-request usage wire, shared by both doors that answer it.
 *
 * Two doors ask the same question and must not answer it in two shapes: the
 * project-scoped `/api/coding-agent/pull-request-usage`, which recovers a
 * calling person through their personal workspace, and the organization-keyed
 * `/api/v1/coding-agent/pull-request-usage`, which needs no project at all.
 * Declared once so a field added for one is on the other, and so the published
 * document describes one response rather than two that happen to agree.
 */
import { z } from "zod";

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
  repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/, {
    message: "repository must be owner/name",
  }),
  pullRequest: z.coerce.number().int().positive(),
  /**
   * Defaults to the GitHub host this instance is bound to, which is github.com
   * unless an operator named an Enterprise Server. The published document
   * states github.com, which is the default every instance has until it names
   * another host.
   */
  host: z.string().min(1),
});

/** The query parameters both doors publish, in the order they are documented. */
export const pullRequestUsageParameters = [
  {
    name: "repository",
    in: "query",
    required: true,
    schema: { type: "string" },
    description: 'The repository as "owner/name".',
  },
  {
    name: "pullRequest",
    in: "query",
    required: true,
    schema: { type: "integer" },
    description: "The pull request number.",
  },
  {
    name: "host",
    in: "query",
    required: false,
    schema: { type: "string", default: "github.com" },
  },
] as const;
