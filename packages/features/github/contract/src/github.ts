import { z } from "zod";

export const githubRepositoryRefSchema = z.object({
  id: z.string(),
  fullName: z.string(),
});

export const githubRepositorySchema = githubRepositoryRefSchema;

export const githubInstallationSchema = z.object({
  installationId: z.string(),
  organizationId: z.string(),
  accountLogin: z.string(),
  accountType: z.string(),
  accountId: z.string(),
  repositorySelection: z.string(),
  repositories: z.array(githubRepositoryRefSchema).nullable(),
  suspendedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const githubPullRequestRefSchema = z.object({
  repositoryHost: z.string().min(1),
  repositoryFullName: z.string().min(1),
  prNumber: z.number().int().positive(),
});

export const githubPullRequestLiveStatusSchema = githubPullRequestRefSchema.extend({
  status: z.enum(["open", "draft", "merged", "closed"]),
  source: z.enum(["live", "snapshot"]),
  mappedAt: z.date().nullable(),
});

export const githubPullRequestSchema = z.object({
  organizationId: z.string(),
  repositoryHost: z.string(),
  repositoryFullName: z.string(),
  headBranch: z.string(),
  prNumber: z.number().int().positive(),
  htmlUrl: z.string(),
  title: z.string(),
  state: z.string(),
  isDraft: z.boolean(),
  authorLogin: z.string().nullable(),
  prCreatedAt: z.date(),
  prClosedAt: z.date().nullable(),
  prMergedAt: z.date().nullable(),
  prUpdatedAt: z.date().nullable(),
  mappedAt: z.date(),
  lastCheckedAt: z.date(),
});

export const githubTurnTokenSchema = z.object({
  token: z.string().min(1),
  repoScopeKey: z.string().min(1),
  installationId: z.string().min(1),
});

export type GithubRepositoryRef = z.infer<typeof githubRepositoryRefSchema>;
export type GithubRepository = z.infer<typeof githubRepositorySchema>;
export type GithubInstallation = z.infer<typeof githubInstallationSchema>;
export type GithubPullRequestRef = z.infer<typeof githubPullRequestRefSchema>;
export type GithubPullRequestLiveStatus = z.infer<
  typeof githubPullRequestLiveStatusSchema
>;
export type GithubTurnToken = z.infer<typeof githubTurnTokenSchema>;
export type GithubPullRequest = z.infer<typeof githubPullRequestSchema>;

export type GithubPullRequestEvent = {
  action: string;
  installationId: string;
  repositoryOwner: string;
  repositoryName: string;
  headBranch: string;
  pullRequest: {
    number: number;
    htmlUrl: string;
    title: string;
    state: string;
    draft: boolean;
    mergedAt: string | null;
    closedAt: string | null;
    createdAt: string;
    updatedAt: string;
    authorLogin: string | null;
  };
};

export type GithubInstallStatePayload = {
  userId: string;
  organizationId: string;
  mode: "popup" | "redirect";
  returnTo: string;
  issuedAt: number;
  nonce: string;
  nonceRegistered: boolean;
};

export type GithubAppConfig = {
  appSlug: string;
  webhookSecret: string;
  configured: boolean;
};
