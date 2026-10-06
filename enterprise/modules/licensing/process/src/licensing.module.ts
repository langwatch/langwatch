import { bindRestCredential } from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { LicensingModule } from "./app/licensing.app.ts";
import { licenseSyncEventing } from "./eventing/license-sync.pipeline.ts";
import { licensingRepositories } from "./repositories/licensing-repositories.registry.ts";
import { connectHostRest } from "./transport/connect-host.rest.ts";
import { connectHostedRest } from "./transport/connect-hosted.rest.ts";
import { connectTrpcTransport } from "./transport/connect.trpc.ts";
import { licenseTrpcTransport } from "./transport/licensing.trpc.ts";

export const licensingProcessModule = defineProcessModule("licensing")
  .withRepositories(licensingRepositories)
  .withApi(LicensingModule)
  .withTransports(licenseTrpcTransport, connectTrpcTransport, connectHostedRest, connectHostRest)
  // The Go data plane signs hosted calls with the gateway's own secret, so the
  // family answers behind the gateway's door rather than a rebuilt one.
  .withTransportFacts(({ dependencies }) => [
    bindRestCredential("internal_secret", () => dependencies.gateway.internalDoor()),
  ])
  .withEventing(licenseSyncEventing);
