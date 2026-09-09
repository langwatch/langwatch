import { defineModule } from "@langwatch/runtime-composition";
import { ServerOrganizationApp } from "./app/organization.app.ts";

export const organizationFeature = defineModule("organization")
  .withApp(ServerOrganizationApp)
  .build();
