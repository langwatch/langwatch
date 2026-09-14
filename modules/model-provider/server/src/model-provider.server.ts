import { bindRestHeader, bindRestMiddleware, projectCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { ModelProviderApp } from "./app/model-provider.app.ts";
import { modelProviderRepositories } from "./repositories/model-provider-repositories.registry.ts";
import { llmModelCostTrpcTransport } from "./transport/llm-model-cost.trpc.ts";
import { modelDefaultsRest, modelDefaultsRestCredential } from "./transport/model-defaults.rest.ts";
import { modelProviderRest } from "./transport/model-provider.rest.ts";
import { modelProviderTrpcTransport } from "./transport/model-provider.trpc.ts";
import {
  playgroundRest,
  playgroundRestModel,
  playgroundRestProject,
  playgroundRestSystemPrompt,
} from "./transport/playground.rest.ts";
import { translateTrpcTransport } from "./transport/translate.trpc.ts";

export type { ModelProviderInfrastructure } from "./app/model-provider.app.ts";

export const modelProviderServer = defineServerModule("model-provider")
  .withRepositories(modelProviderRepositories)
  .withApp(ModelProviderApp)
  .withTransports(
    modelProviderRest,
    modelDefaultsRest,
    playgroundRest,
    modelProviderTrpcTransport,
    llmModelCostTrpcTransport,
    translateTrpcTransport,
  )
  // The playground's caller and execution proxy address are resolved by the process (session
  // cookie, platform address) and stay on the host's fact list; other headers need no collaborator.
  .withTransportFacts(() => [
    bindRestMiddleware(modelDefaultsRestCredential, (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);
      if (credential.type !== "apiKey") return null;

      return {
        apiKeyId: credential.apiKeyId,
        userId: credential.userId,
        organizationId: credential.organizationId,
      };
    }),
    bindRestHeader(playgroundRestModel, "x-model"),
    bindRestHeader(playgroundRestProject, "x-project-id"),
    bindRestHeader(playgroundRestSystemPrompt, "x-system-prompt"),
  ]);
