/**
 * The organization's view of its GitHub connection: what a settings surface
 * renders, and what a disconnect hands back.
 *
 * Deliberately narrower than `GithubInstallation`: a member who can see that a
 * connection exists is not shown the repository names it reaches, only how
 * many of them a "selected" install covers.
 */
import { z } from "zod";
import { githubPullRequestLiveStatusSchema } from "./github.ts";

export const githubInstallationSummarySchema = z.object({
  installationId: z.string(),
  accountLogin: z.string(),
  accountType: z.string(),
  repositorySelection: z.string(),
  /** Known only for a "selected" install; "all" resolves live. */
  repositoryCount: z.number().nullable(),
  suspended: z.boolean(),
  /** GitHub can only be uninstalled on GitHub, so this deep-links there. */
  uninstallUrl: z.string(),
});
export type GithubInstallationSummary = z.infer<typeof githubInstallationSummarySchema>;

export const githubConnectionStatusSchema = z.object({
  /** Whether this instance can start an installation at all. */
  configured: z.boolean(),
  connected: z.boolean(),
  installations: z.array(githubInstallationSummarySchema),
  /** Where an install starts, or null on an instance that cannot start one. */
  installUrl: z.string().nullable(),
});
export type GithubConnectionStatus = z.infer<typeof githubConnectionStatusSchema>;

/**
 * GitHub cannot be uninstalled through the API, so disconnecting hands back
 * the deep link a human follows; the webhook removes the local row once
 * GitHub confirms.
 */
export const githubDisconnectResultSchema = z.object({ uninstallUrl: z.string() });
export type GithubDisconnectResult = z.infer<typeof githubDisconnectResultSchema>;

/** What the live pull-request read answers with, for a page of refs. */
export const githubPullRequestLiveStatusesSchema = z.object({
  statuses: z.array(githubPullRequestLiveStatusSchema),
});

/**
 * One line the deployment's audit trail records about a connection: who acted,
 * the organization it was done to, the stable name of the act, and the little
 * the trail keeps of what was named. Both doors write the same shape.
 */
export type GithubConnectionAuditEntry = Readonly<{
  userId: string;
  organizationId: string;
  action: string;
  args: Readonly<Record<string, unknown>>;
}>;
