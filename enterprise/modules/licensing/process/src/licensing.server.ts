import { bindRestCredential } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { LicensingApp } from "./app/licensing.app.ts";
import { licenseSyncEventing } from "./eventing/license-sync.pipeline.ts";
import { connectHostRest } from "./transport/connect-host.rest.ts";
import { connectHostedRest } from "./transport/connect-hosted.rest.ts";
import { connectTrpcTransport } from "./transport/connect.trpc.ts";
import { licenseEnforcementTrpcTransport } from "./transport/license-enforcement.trpc.ts";
import { licenseTrpcTransport } from "./transport/licensing.trpc.ts";

export type { LicensingInfrastructure, LicensingRuntime } from "./app/licensing.app.ts";

export const licensingServer = defineServerModule("licensing")
  .withApp(LicensingApp)
  .withTransports(
    licenseTrpcTransport,
    licenseEnforcementTrpcTransport,
    connectTrpcTransport,
    connectHostedRest,
    connectHostRest,
  )
  .withTransportFacts(({ app }) => {
    if (!(app instanceof LicensingApp)) {
      throw new TypeError("The hosted Connect family requires its constructed application");
    }

    // The signing scheme is the gateway's own, so the door travels in rather
    // than being rebuilt here; a process composing none refuses by name.
    return [bindRestCredential("internalSecret", () => app.hostedDoor)];
  })
  .withEventing(licenseSyncEventing);
