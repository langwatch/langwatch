import { defineFeature } from "@langwatch/runtime-composition";
import { TraceApp } from "./app/trace.app.ts";

/** The process-owned collaborators needed to construct the Trace application once. */
export type { TraceInfrastructure } from "./app/trace-composition.types.ts";

/** Canonical Trace server feature installer and application factory. */
export const traceServer = defineFeature("trace").withApp(TraceApp).build();
