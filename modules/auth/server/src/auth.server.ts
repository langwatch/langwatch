import { defineServerModule } from "@langwatch/runtime-composition";
import { AuthApp } from "./app/auth.app.ts";
import { authRepositories } from "./repositories/auth-repositories.registry.ts";
import { authRest } from "./transport/auth.rest.ts";
import { frontDoorTrpcTransport } from "./transport/front-door.trpc.ts";

/**
 * The `frontDoor.*` namespace and the `/api/auth` family are declared here,
 * over the SAME application: the door object IS this module's app now, because
 * the app builds the deployment's one Better Auth instance rather than
 * receiving it from whichever process happened to compose one.
 *
 * `/api/auth/cli` is still absent — the device grant's store is a peer surface
 * this module does not yet resolve, and mounting the family over a half-built
 * door would answer RFC 8628 with a refusal instead of not answering at all.
 */
export const authServer = defineServerModule("auth")
  .withRepositories(authRepositories)
  .withApp(AuthApp)
  .withTransports(frontDoorTrpcTransport, authRest);
