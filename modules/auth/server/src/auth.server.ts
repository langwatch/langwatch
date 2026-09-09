import { defineModule } from "@langwatch/runtime-composition";
import { AuthApp } from "./app/auth.app.ts";
import { authRepositories } from "./repositories/auth-repositories.registry.ts";
import { frontDoorTrpcTransport } from "./transport/front-door.trpc.ts";

/**
 * The `frontDoor.*` namespace is declared here; the two REST families
 * (`/api/auth` and `/api/auth/cli`) are not, because their door objects are
 * the deployment's own Better Auth instance and its device-grant store rather
 * than this application. They mount on the process's REST door table.
 */
export const authServer = defineModule("auth")
  .withRepositories(authRepositories)
  .withApp(AuthApp)
  .withTransports(frontDoorTrpcTransport)
  .build();
