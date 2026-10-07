import { defineProcessModule } from "@langwatch/process";

import { DataPrivacyModule } from "./app/data-privacy.app.ts";
import { dataPrivacyProjectScopeEventing } from "./eventing/data-privacy-project-scope.pipeline.ts";
import { dataPrivacyRepositories } from "./repositories/data-privacy-repositories.registry.ts";
import { dataPrivacyTrpcTransport } from "./transport/data-privacy.trpc.ts";

export const dataPrivacyProcessModule = defineProcessModule("data-privacy")
  .withRepositories(dataPrivacyRepositories)
  .withApi(DataPrivacyModule)
  .withTransports(dataPrivacyTrpcTransport)
  .withEventing(dataPrivacyProjectScopeEventing);
