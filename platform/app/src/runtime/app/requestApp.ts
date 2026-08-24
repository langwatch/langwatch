import type { App } from "~/server/app-layer/app";

/**
 * Compatibility name for transports that still import the former request-app
 * surface. There is no separate request application: every transport receives
 * the same process-owned App instance.
 */
export type RequestAppServices = App;
