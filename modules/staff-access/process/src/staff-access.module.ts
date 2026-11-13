import { bindRestCredential, bindStaffAccessGate } from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { StaffAccessApi, StaffAccessServerConfig } from "@langwatch/staff-access-contract";

import { StaffAccessModule } from "./app/staff-access.app.ts";
import { staffAccessExpiryEventing } from "./eventing/staff-access-expiry.pipeline.ts";
import { staffAccessRepositories } from "./repositories/staff-access-repositories.registry.ts";
import { staffAccessRest } from "./transport/staff-access.rest.ts";
import { staffAccessTrpcTransport } from "./transport/staff-access.trpc.ts";

export const staffAccessProcessModule: PublishedProcessModule<
  "staff-access",
  StaffAccessApi,
  StaffAccessServerConfig
> = defineProcessModule("staff-access")
  .withRepositories(staffAccessRepositories)
  .withApi(StaffAccessModule)
  .withTransports(staffAccessRest, staffAccessTrpcTransport)
  // The door reads the agent's bearer; the gate stands before every staff key's handler.
  .provideMiddlewareBindings(({ app }) => [
    bindRestCredential("staff_access", () => app.staffAccessDoor),
    bindStaffAccessGate(app.staffAccessGate),
  ])
  .withEventing(staffAccessExpiryEventing);
