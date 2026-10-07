import { z } from "zod";

/** GitHub's installation facts, which peers react to from their own side (§9). */
export const GITHUB_LIFECYCLE_PIPELINE_NAME = "github_lifecycle" as const;
export const GITHUB_INSTALLATION_AGGREGATE_TYPE = "github_installation" as const;
export const GITHUB_INSTALLATION_CONNECTED_EVENT_TYPE = "lw.github.installation_connected" as const;
export const GITHUB_INSTALLATION_CONNECTED_EVENT_VERSION = "2026-10-07" as const;

/** Ids only: a peer reads anything else through `GithubApi`, never the event. */
export const githubInstallationConnectedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  installationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export type GithubInstallationConnectedEventData = z.infer<
  typeof githubInstallationConnectedEventDataSchema
>;
