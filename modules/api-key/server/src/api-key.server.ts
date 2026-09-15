import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { ApiKeyApp } from "./app/api-key.app.ts";
import { apiKeyEventing } from "./eventing/api-key.pipeline.ts";
import { apiKeyRepositories } from "./repositories/api-key-repositories.registry.ts";
import { apiKeyRest, apiKeyRestCredential } from "./transport/api-key.rest.ts";
import { apiKeyTrpcTransport } from "./transport/api-key.trpc.ts";

/**
 * The whole module, declared. Every call answers something already
 * installable, so there is no build step to forget. What the process must
 * hand it is read off `ApiKeyApp.create` and off the repository registry —
 * its repositories, its three peers and its own config slice.
 */
export const apiKeyServer = defineServerModule("api-key")
  .withRepositories(apiKeyRepositories)
  .withApp(ApiKeyApp)
  .withTransports(apiKeyRest, apiKeyTrpcTransport)
  // The credential itself, not just its holder: two of these routes ask whether
  // the KEY may act organization-wide as well as whether the member may, so a
  // narrowed key cannot borrow the reach of whoever created it.
  .withTransportFacts(() => [
    bindRestMiddleware(apiKeyRestCredential, (context) => {
      const credential = organizationCredentialOfRequest(context.req.raw);

      return { apiKeyId: credential.apiKeyId, userId: credential.userId };
    }),
  ])
  .withEventing(apiKeyEventing);
