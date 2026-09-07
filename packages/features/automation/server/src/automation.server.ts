import { defineFeature } from "@langwatch/runtime-composition";
import { AutomationApp } from "./app/automation.app.ts";

export type { AutomationInfrastructure } from "./app/automation.app.ts";

export const automationServer = defineFeature("automation").withApp(AutomationApp).build();
