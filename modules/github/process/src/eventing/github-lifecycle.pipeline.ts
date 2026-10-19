import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";
import {
  GITHUB_INSTALLATION_AGGREGATE_TYPE,
  GITHUB_LIFECYCLE_PIPELINE_NAME,
} from "@langwatch/github-contract";

import type { GithubModule } from "../app/github.app.ts";
import type { GithubRepositories } from "../repositories/github.repositories.ts";
import { RecordInstallationConnectedCommand } from "./github-lifecycle.commands.ts";
import { githubInstallationConnectedEventSchema } from "./github-lifecycle.events.ts";

/**
 * github_lifecycle: GitHub records its installation facts; peers react from their own
 * side (§9).
 */
function buildGithubLifecyclePipeline() {
  return definePipeline({
    name: GITHUB_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: GITHUB_INSTALLATION_AGGREGATE_TYPE }),
  })
    .withEvents([githubInstallationConnectedEventSchema])
    .withCommand("recordInstallationConnected", RecordInstallationConnectedCommand)
    .build();
}

export const githubLifecycleEventing = defineEventingModule({
  pipeline: GITHUB_LIFECYCLE_PIPELINE_NAME,
  build: (_setup: EventingSetup<GithubRepositories, GithubModule>) =>
    buildGithubLifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});
