import type { GithubApi, GithubServerConfig } from "@langwatch/github-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { GithubModule } from "./app/github.app.ts";
import { githubChannels } from "./channels/github-channels.registry.ts";
import { githubLifecycleEventing } from "./eventing/github-lifecycle.pipeline.ts";
import { githubMaintenanceEventing } from "./eventing/github-maintenance.pipeline.ts";
import { githubRepositories } from "./repositories/github-repositories.registry.ts";
import { githubInstallRest } from "./transport/github-install.rest.ts";
import { githubTrpcTransport } from "./transport/github.trpc.ts";

export const githubProcessModule: PublishedProcessModule<"github", GithubApi, GithubServerConfig> =
  defineProcessModule("github")
    .withRepositories(githubRepositories)
    .withChannels(githubChannels)
    .withApi(GithubModule)
    .withTransports(githubInstallRest, githubTrpcTransport)
    .withEventing(githubMaintenanceEventing)
    .withEventing(githubLifecycleEventing);
