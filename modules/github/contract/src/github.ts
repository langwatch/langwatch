import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The signed webhook's JSON envelope; each GitHub event owns its inner definition. */
const githubWebhookEnvelopeSchemaDefinition = z.record(z.string(), z.unknown());
export interface GithubWebhookEnvelopeSchema extends Named<
  typeof githubWebhookEnvelopeSchemaDefinition
> {}
export const githubWebhookEnvelopeSchema: GithubWebhookEnvelopeSchema =
  githubWebhookEnvelopeSchemaDefinition;
export type GithubWebhookEnvelope = z.infer<typeof githubWebhookEnvelopeSchema>;

/** The installation-start redirect's query; its permission is checked at `organizationId`. */
const githubInstallStartQuerySchemaDefinition = z.object({
  organizationId: z.string(),
  account: z.string().optional(),
  installationId: z.string().optional(),
  mode: z.string().optional(),
  return: z.string().optional(),
});
export interface GithubInstallStartQuerySchema extends Named<
  typeof githubInstallStartQuerySchemaDefinition
> {}
export const githubInstallStartQuerySchema: GithubInstallStartQuerySchema =
  githubInstallStartQuerySchemaDefinition;

const githubRepositoryRefSchemaDefinition = z.object({
  id: z.string(),
  fullName: z.string(),
});
export interface GithubRepositoryRefSchema extends Named<
  typeof githubRepositoryRefSchemaDefinition
> {}
export const githubRepositoryRefSchema: GithubRepositoryRefSchema =
  githubRepositoryRefSchemaDefinition;

export const githubRepositorySchema = githubRepositoryRefSchema;

const githubInstallationSchemaDefinition = z.object({
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
export interface GithubInstallationSchema extends Named<
  typeof githubInstallationSchemaDefinition
> {}
export const githubInstallationSchema: GithubInstallationSchema =
  githubInstallationSchemaDefinition;

const githubPullRequestRefSchemaDefinition = z.object({
  repositoryHost: z.string().min(1),
  repositoryFullName: z.string().min(1),
  prNumber: z.number().int().positive(),
});
export interface GithubPullRequestRefSchema extends Named<
  typeof githubPullRequestRefSchemaDefinition
> {}
export const githubPullRequestRefSchema: GithubPullRequestRefSchema =
  githubPullRequestRefSchemaDefinition;

const githubPullRequestLiveStatusSchemaDefinition = z.object({
  ...githubPullRequestRefSchema.shape,
  status: z.enum(["open", "draft", "merged", "closed"]),
  source: z.enum(["live", "snapshot"]),
  mappedAt: z.date().nullable(),
});
export interface GithubPullRequestLiveStatusSchema extends Named<
  typeof githubPullRequestLiveStatusSchemaDefinition
> {}
export const githubPullRequestLiveStatusSchema: GithubPullRequestLiveStatusSchema =
  githubPullRequestLiveStatusSchemaDefinition;

const githubPullRequestSchemaDefinition = z.object({
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
export interface GithubPullRequestSchema extends Named<typeof githubPullRequestSchemaDefinition> {}
export const githubPullRequestSchema: GithubPullRequestSchema = githubPullRequestSchemaDefinition;

const githubTurnTokenSchemaDefinition = z.object({
  token: z.string().min(1),
  repoScopeKey: z.string().min(1),
  installationId: z.string().min(1),
});
export interface GithubTurnTokenSchema extends Named<typeof githubTurnTokenSchemaDefinition> {}
export const githubTurnTokenSchema: GithubTurnTokenSchema = githubTurnTokenSchemaDefinition;

export type GithubRepositoryRef = z.infer<typeof githubRepositoryRefSchema>;
export type GithubRepository = z.infer<typeof githubRepositorySchema>;
export type GithubInstallation = z.infer<typeof githubInstallationSchema>;
export type GithubPullRequestRef = z.infer<typeof githubPullRequestRefSchema>;
export type GithubPullRequestLiveStatus = z.infer<typeof githubPullRequestLiveStatusSchema>;
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

export const GITHUB_LINKING_PULL_REQUEST_ACTIONS = [
  "opened",
  "reopened",
  "synchronize",
  "edited",
  "converted_to_draft",
  "ready_for_review",
  "closed",
] as const;

const githubInstallStatePayloadSchemaDefinition = z
  .object({
    userId: z.string(),
    organizationId: z.string(),
    mode: z.enum(["popup", "redirect"]),
    returnTo: z.string(),
    issuedAt: z.number(),
    nonce: z.string(),
    nonceRegistered: z.boolean(),
    /**
     * The GitHub account this flow was started for, when the flow named one. The setup
     * callback refuses an installation whose account is a different one.
     */
    expectedAccountLogin: z.string().optional(),
    /**
     * An installation this organization already owns, pinned when the flow is a
     * reconfigure and therefore already knows which installation it is returning to.
     */
    expectedInstallationId: z.string().optional(),
  })
  .strict();
export interface GithubInstallStatePayloadSchema extends Named<
  typeof githubInstallStatePayloadSchemaDefinition
> {}
export const githubInstallStatePayloadSchema: GithubInstallStatePayloadSchema =
  githubInstallStatePayloadSchemaDefinition;

export type GithubInstallStatePayload = z.infer<typeof githubInstallStatePayloadSchema>;

export type GithubAppConfig = {
  appSlug: string;
  webhookSecret: string;
  configured: boolean;
};

/** GitHub's installation facts, which peers react to from their own side (§9). */
export const GITHUB_LIFECYCLE_PIPELINE_NAME = "github_lifecycle" as const;
export const GITHUB_INSTALLATION_AGGREGATE_TYPE = "github_installation" as const;
export const GITHUB_INSTALLATION_CONNECTED_EVENT_TYPE = "lw.github.installation_connected" as const;
export const GITHUB_INSTALLATION_CONNECTED_EVENT_VERSION = "2026-10-07" as const;

/** Ids only: a peer reads anything else through `GithubApi`, never the event. */
const githubInstallationConnectedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  installationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export interface GithubInstallationConnectedEventDataSchema extends Named<
  typeof githubInstallationConnectedEventDataSchemaDefinition
> {}
export const githubInstallationConnectedEventDataSchema: GithubInstallationConnectedEventDataSchema =
  githubInstallationConnectedEventDataSchemaDefinition;
export type GithubInstallationConnectedEventData = z.infer<
  typeof githubInstallationConnectedEventDataSchema
>;
