import { defineFeature } from "@langwatch/runtime-composition";
import { LicensingApp } from "./app/licensing.app.ts";

export type { LicensingInfrastructure, LicensingRuntime } from "./app/licensing.app.ts";

export const licensingServer = defineFeature("licensing").withApp(LicensingApp).build();
