import { defineServerModule } from "@langwatch/kernel";

import { IdentityApp } from "./app/identity.app.ts";
import { identityEventing } from "./eventing/identity.pipeline.ts";
import { joinRequestEventing } from "./eventing/join-request.pipeline.ts";
import { scimSyncEventing } from "./eventing/scim-sync.pipeline.ts";
import { ssoConnectionEventing } from "./eventing/sso-connection.pipeline.ts";
import { identityPipelineEventing } from "./eventing/user-identity.pipeline.ts";
import { identityRepositories } from "./repositories/identity-repositories.registry.ts";

/**
 * No `.withTransports(...)` - identity has no `transport/` directory and
 * serves no doors of its own.
 */
export const identityServer = defineServerModule("identity")
  .withRepositories(identityRepositories)
  .withApp(IdentityApp)
  .withEventing(identityEventing)
  .withEventing(identityPipelineEventing)
  .withEventing(joinRequestEventing)
  .withEventing(scimSyncEventing)
  .withEventing(ssoConnectionEventing);
