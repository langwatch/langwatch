import { projectCredentialOfRequest } from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { PromptApi, PromptServerConfig } from "@langwatch/prompt-contract";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { PromptModule } from "./app/prompt.app.ts";
import { promptLifecycleEventing } from "./eventing/prompt-lifecycle.pipeline.ts";
import { promptRepositories } from "./repositories/prompt-repositories.registry.ts";
import { PromptTagBackfillService } from "./services/prompt-tag-backfill.service.ts";
import { promptExecuteRest } from "./transport/prompt-execute.rest.ts";
import { promptTagTrpcTransport } from "./transport/prompt-tag.trpc.ts";
import { promptRest } from "./transport/prompt.rest.ts";
import { promptTrpcTransport } from "./transport/prompt.trpc.ts";

/** Prompt library server — tRPC, REST, and the browser-only playground stream. */
export const promptProcessModule: PublishedProcessModule<"prompt", PromptApi, PromptServerConfig> =
  defineProcessModule("prompt")
    .withRepositories(promptRepositories)
    .withApi(PromptModule)
    .withTransports(promptRest, promptExecuteRest, promptTrpcTransport, promptTagTrpcTransport)
    .withEventing(promptLifecycleEventing)
    .withMigrations(({ repositories }) => {
      const backfill = PromptTagBackfillService.create({ peers: { tags: repositories.tags } });
      return [
        defineMigrationStep({
          id: "prompt:seed-tags-for-untagged-organizations",
          kind: "tenant",
          mode: "background",
          tenants: "organization",
          title: "Default prompt tags",
          description:
            "Seeds the production and staging prompt tags for every organization that has none.",
          requiresOperatorConfirmation: false,
          runsAutomaticallyOnSelfHosted: true,
          enrolledAutomatically: true,
          migrateTenant: (args) => backfill.migrateTenant(args),
        }),
      ];
    })
    // Both contexts come off the credential the request already carries: the
    // organization the project belongs to, and the deep link back into the
    // library, which the app builds from its own configured `publicBaseUrl`.
    .provideMiddlewareContext({
      promptRestContext: (request, { app }) => {
        const { project } = projectCredentialOfRequest(request);

        return {
          organizationId: project.organizationId,
          promptsUrl: app.promptsPlatformUrl({ projectSlug: project.slug }),
        };
      },
    });
