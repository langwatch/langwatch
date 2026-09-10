import { defineModule } from "@langwatch/runtime-composition";
import { IdentityApp } from "./app/identity.app.ts";
import { identityRepositories } from "./repositories/identity-repositories.registry.ts";

/** No `.withTransports(...)` - identity has no `transport/` directory and serves no doors of its own. */
export const identityServer = defineModule("identity")
  .withRepositories(identityRepositories)
  .withApp(IdentityApp)
  .build();
