import {
  bindRestMiddleware,
  principalOfCredential,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { ModelProviderModule } from "./app/model-provider.app.ts";
import { modelProviderRepositories } from "./repositories/model-provider-repositories.registry.ts";
import { ModelProviderCredentialsMigrateTask } from "./tasks/model-provider-credentials-migrate.task.ts";
import { ModelProviderCustomModelsMigrateTask } from "./tasks/model-provider-custom-models-migrate.task.ts";
import { ModelRegistrySyncTask } from "./tasks/model-registry-sync.task.ts";
import { llmModelCostTrpcTransport } from "./transport/llm-model-cost.trpc.ts";
import { modelDefaultsRest, modelDefaultsRestCredential } from "./transport/model-defaults.rest.ts";
import { modelProviderRest } from "./transport/model-provider.rest.ts";
import { modelProviderTrpcTransport } from "./transport/model-provider.trpc.ts";
import { playgroundRest } from "./transport/playground.rest.ts";
import { translateTrpcTransport } from "./transport/translate.trpc.ts";

export const modelProviderProcessModule = defineProcessModule("model-provider")
  .withRepositories(modelProviderRepositories)
  .withApi(ModelProviderModule)
  .withTransports(
    modelProviderRest,
    modelDefaultsRest,
    playgroundRest,
    modelProviderTrpcTransport,
    llmModelCostTrpcTransport,
    translateTrpcTransport,
  )
  .withTransportFacts(() => [
    bindRestMiddleware(modelDefaultsRestCredential, (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);
      const principal = principalOfCredential(credential);
      if (principal === null || credential.type === "legacyProjectKey") return null;

      return { principal, userId: credential.userId, organizationId: credential.organizationId };
    }),
  ])
  .withTasks(async ({ secrets, repositories }) => [
    await secrets.into(ModelProviderModule.operationalSecrets.openRouter, (apiKey) =>
      ModelRegistrySyncTask.create({ apiKey: () => apiKey }),
    ),
    ModelProviderCredentialsMigrateTask.create({ database: () => repositories.providers }),
    ModelProviderCustomModelsMigrateTask.create({ database: () => repositories.providers }),
  ]);
