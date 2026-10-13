import { principalOfCredential, projectCredentialOfRequest } from "@langwatch/api/rest";
import type {
  ModelProviderApi,
  ModelProviderServerConfig,
} from "@langwatch/model-provider-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { ModelProviderModule } from "./app/model-provider.app.ts";
import { modelProviderChannels } from "./channels/model-provider-channels.registry.ts";
import { modelProviderRepositories } from "./repositories/model-provider-repositories.registry.ts";
import { ModelProviderKeysSealService } from "./services/model-provider-keys-seal.service.ts";
import { ModelProviderCustomModelsMigrateTask } from "./tasks/model-provider-custom-models-migrate.task.ts";
import { ModelRegistrySyncTask } from "./tasks/model-registry-sync.task.ts";
import { llmModelCostTrpcTransport } from "./transport/llm-model-cost.trpc.ts";
import { modelDefaultsRest } from "./transport/model-defaults.rest.ts";
import { modelProviderRest } from "./transport/model-provider.rest.ts";
import { modelProviderTrpcTransport } from "./transport/model-provider.trpc.ts";
import { playgroundRest } from "./transport/playground.rest.ts";
import { translateTrpcTransport } from "./transport/translate.trpc.ts";

export const modelProviderProcessModule: PublishedProcessModule<
  "model-provider",
  ModelProviderApi,
  ModelProviderServerConfig
> = defineProcessModule("model-provider")
  .withRepositories(modelProviderRepositories)
  .withChannels(modelProviderChannels)
  .withApi(ModelProviderModule)
  .withTransports(
    modelProviderRest,
    modelDefaultsRest,
    playgroundRest,
    modelProviderTrpcTransport,
    llmModelCostTrpcTransport,
    translateTrpcTransport,
  )
  .provideMiddlewareContext({
    modelDefaultsRestCredential: (request) => {
      const credential = projectCredentialOfRequest(request);
      const principal = principalOfCredential(credential);
      if (principal === null || credential.type === "legacyProjectKey") return null;

      return { principal, userId: credential.userId, organizationId: credential.organizationId };
    },
  })
  .withTasks(async ({ secrets, repositories }) => [
    await secrets.into(ModelProviderModule.operationalSecrets.openRouter, (apiKey) =>
      ModelRegistrySyncTask.create({ apiKey: () => apiKey }),
    ),
    ModelProviderCustomModelsMigrateTask.create({ database: () => repositories.providers }),
  ])
  .withMigrations(({ repositories }) => [
    defineMigrationStep({
      id: "model-provider:seal-plaintext-custom-keys",
      kind: "data",
      mode: "background",
      description: "Encrypts model provider API keys still stored in plaintext.",
      needsOldWritersGone: true,
      run: async ({ checkpoint, dryRun, signal }) => {
        const resumed = checkpoint.resumeFrom?.afterId;
        return ModelProviderKeysSealService.create({
          providers: repositories.providers,
        }).sealPlaintextKeys({
          dryRun,
          signal,
          afterId: typeof resumed === "string" ? resumed : null,
          onRowDone: (report) => checkpoint.save({ report }),
        });
      },
    }),
  ]);
