import { defineModule } from "@langwatch/runtime-composition";
import { ModelProviderApp } from "./app/model-provider.app.ts";
import { modelProviderRepositories } from "./repositories/model-provider-repositories.registry.ts";
import { llmModelCostTrpcTransport } from "./transport/llm-model-cost.trpc.ts";
import { modelDefaultsRest } from "./transport/model-defaults.rest.ts";
import { modelProviderRest } from "./transport/model-provider.rest.ts";
import { modelProviderTrpcTransport } from "./transport/model-provider.trpc.ts";
import { playgroundRest } from "./transport/playground.rest.ts";
import { translateTrpcTransport } from "./transport/translate.trpc.ts";

export type { ModelProviderInfrastructure } from "./app/model-provider.app.ts";

export const modelProviderServer = defineModule("model-provider")
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
  .build();
