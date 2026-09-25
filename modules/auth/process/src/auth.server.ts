import { defineServerModule } from "@langwatch/kernel";

import { AuthApp } from "./app/auth.app.ts";
import { authEventing } from "./eventing/auth.pipeline.ts";
import { authRepositories } from "./repositories/auth-repositories.registry.ts";
import { authCliDeviceFlowRest } from "./transport/auth-cli-device-flow.rest.ts";
import { authRest } from "./transport/auth.rest.ts";
import { frontDoorTrpcTransport } from "./transport/front-door.trpc.ts";
import { signInSecurityTrpcTransport } from "./transport/sign-in-security.trpc.ts";

/**
 * Frontdoor.* and /api/auth routes over one application. App builds the Better
 * Auth instance. The CLI device grant mounts before the /api/auth catch-all.
 */
export const authServer = defineServerModule("auth")
  .withRepositories(authRepositories)
  .withApp(AuthApp)
  .withTransports(
    frontDoorTrpcTransport,
    signInSecurityTrpcTransport,
    authCliDeviceFlowRest,
    authRest,
  )
  .withEventing(authEventing);
