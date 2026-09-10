import { defineServerModule } from "@langwatch/runtime-composition";
import { DataPrivacyApp } from "./app/data-privacy.app.ts";
import { dataPrivacyRepositories } from "./repositories/data-privacy-repositories.registry.ts";
import { dataPrivacyTrpcTransport } from "./transport/data-privacy.trpc.ts";

export const dataPrivacyServer = defineServerModule("data-privacy")
  .withRepositories(dataPrivacyRepositories)
  .withApp(DataPrivacyApp)
  .withTransports(dataPrivacyTrpcTransport)
  .build();
