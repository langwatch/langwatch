import { defineFeature } from "@langwatch/runtime-composition";
import { EntitlementApp } from "./app/entitlement.app.ts";

export type { EntitlementInfrastructure } from "./app/entitlement.app.ts";

export const entitlementServer = defineFeature("entitlement").withApp(EntitlementApp).build();
