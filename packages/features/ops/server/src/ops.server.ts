import { defineFeature } from "@langwatch/runtime-composition";
import { OpsApp } from "./app/ops.app.ts";

export const opsServer = defineFeature("ops").withApp(OpsApp).build();
