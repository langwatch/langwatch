import type { DataPrivacyApi, DataPrivacyServerConfig } from "@langwatch/data-privacy-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { DataPrivacyModule } from "./app/data-privacy.app.ts";
import { dataPrivacyChannels } from "./channels/data-privacy-channels.registry.ts";
import { dataPrivacyRepositories } from "./repositories/data-privacy-repositories.registry.ts";
import { dataPrivacyTrpcTransport } from "./transport/data-privacy.trpc.ts";

export const dataPrivacyProcessModule: PublishedProcessModule<
  "data-privacy",
  DataPrivacyApi,
  DataPrivacyServerConfig
> = defineProcessModule("data-privacy")
  .withRepositories(dataPrivacyRepositories)
  .withChannels(dataPrivacyChannels)
  .withApi(DataPrivacyModule)
  .withTransports(dataPrivacyTrpcTransport);
