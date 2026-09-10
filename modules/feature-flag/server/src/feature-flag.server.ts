import { defineServerModule } from "@langwatch/runtime-composition";
import { FeatureFlagApp } from "./app/feature-flag.app.ts";
import { featureFlagRepositories } from "./repositories/feature-flag-repositories.registry.ts";
import { featureFlagTrpcTransport } from "./transport/feature-flag.trpc.ts";

export const featureFlagServer = defineServerModule("feature-flag")
  .withRepositories(featureFlagRepositories)
  .withApp(FeatureFlagApp)
  .withTransports(featureFlagTrpcTransport)
  .build();
