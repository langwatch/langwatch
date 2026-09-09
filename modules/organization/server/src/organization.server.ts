import { defineFeature } from "@langwatch/runtime-composition";
import { ServerOrganizationApp } from "./app/organization.app.ts";

export const organizationFeature = defineFeature("organization")
  .withApp(ServerOrganizationApp)
  .build();
