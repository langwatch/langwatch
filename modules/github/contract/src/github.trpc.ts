/**
 * Every `github.*` procedure, declared once. The names are the browser's cache
 * keys, so they are the wire names the integrations page and the coding-agent
 * surfaces have always called.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { githubPullRequestRefSchema, githubRepositoryRefSchema } from "./github.ts";
import {
  githubConnectionStatusSchema,
  githubDisconnectResultSchema,
  githubPullRequestLiveStatusesSchema,
} from "./github.connection.ts";

/** The organization a connection is read or written against. */
const organizationScopeSchema = z.object({ organizationId: z.string() });

/** One installation of one organization, named for removal. */
const disconnectInputSchema = z.object({
  organizationId: z.string(),
  installationId: z.string(),
});

/**
 * The pull requests on one page. Capped at fifty because the answer is read
 * live from GitHub, one request per distinct repository behind the cache.
 */
const pullRequestLiveStatusInputSchema = z.object({
  projectId: z.string(),
  refs: z.array(githubPullRequestRefSchema).max(50),
});

export const githubTrpc = defineTrpcContract("github")
  .query("getConnectionStatus")
  .withInput(organizationScopeSchema)
  .withOutput(githubConnectionStatusSchema)

  .query("listRepos")
  .withInput(organizationScopeSchema)
  .withOutput(githubRepositoryRefSchema.array())

  /**
   * The current status of the pull requests on a page, read live from GitHub
   * (cached briefly) with the stored snapshot as the fallback.
   */
  .query("pullRequestLiveStatus")
  .withInput(pullRequestLiveStatusInputSchema)
  .withOutput(githubPullRequestLiveStatusesSchema)

  .mutation("disconnect")
  .withInput(disconnectInputSchema)
  .withOutput(githubDisconnectResultSchema)
  .build();
