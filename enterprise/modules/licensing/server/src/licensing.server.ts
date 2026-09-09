import { defineModule } from "@langwatch/runtime-composition";
import { LicensingApp } from "./app/licensing.app.ts";
import { licenseEnforcementTrpcTransport } from "./transport/license-enforcement.trpc.ts";
import { licenseTrpcTransport } from "./transport/licensing.trpc.ts";

export type { LicensingInfrastructure, LicensingRuntime } from "./app/licensing.app.ts";

export const licensingServer = defineModule("licensing")
  .withApp(LicensingApp)
  .withTransports(licenseTrpcTransport, licenseEnforcementTrpcTransport)
  .build();
