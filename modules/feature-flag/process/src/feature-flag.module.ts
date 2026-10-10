import type { FeatureFlagApi, FeatureFlagServerConfig } from "@langwatch/feature-flag-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { FeatureFlagModule } from "./app/feature-flag.app.ts";
import { featureFlagRepositories } from "./repositories/feature-flag-repositories.registry.ts";
import { featureFlagTrpcTransport } from "./transport/feature-flag.trpc.ts";

export const featureFlagProcessModule: PublishedProcessModule<
  "feature-flag",
  FeatureFlagApi,
  FeatureFlagServerConfig
> = defineProcessModule("feature-flag")
  .withRepositories(featureFlagRepositories)
  .withApi(FeatureFlagModule)
  .withTransports(featureFlagTrpcTransport);
