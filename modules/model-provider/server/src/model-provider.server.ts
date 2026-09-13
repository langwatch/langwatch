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
  // Null for a credential that names no key row - a legacy project key - which
  // is what the snapshot's per-member view is filtered on.
  //
  // The playground's own caller (the signed-in person and their standing on
  // the project header names) and its execution proxy address are resolved by
  // the PROCESS - a session cookie and a platform address, neither of which
  // this module can answer for itself - and stay bound on the host's own
  // fact list. `x-model`, `x-project-id` and `x-system-prompt` travel as
  // plain headers and need no such collaborator.
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
  ])
  .build();
