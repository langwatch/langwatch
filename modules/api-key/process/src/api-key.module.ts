import type { ApiKeyApi } from "@langwatch/api-key-contract";
import {
  organizationCredentialOfRequest,
  principalOfCredential,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { ApiKeyModule } from "./app/api-key.app.ts";
import { apiKeyEventing } from "./eventing/api-key.pipeline.ts";
import { apiKeyRepositories } from "./repositories/api-key-repositories.registry.ts";
import { apiKeyOrganizationsRest } from "./transport/api-key-organizations.rest.ts";
import { apiKeyProjectsRest } from "./transport/api-key-projects.rest.ts";
import { apiKeyRest } from "./transport/api-key.rest.ts";
import { apiKeyTrpcTransport } from "./transport/api-key.trpc.ts";

/**
 * The whole module, declared. Every call answers something already
 * installable, so there is no build step to forget. What the process must
 * hand it is read off `ApiKeyModule.create` and the repository registry.
 */
export const apiKeyProcessModule: PublishedProcessModule<"api-key", ApiKeyApi> =
  defineProcessModule("api-key")
    .withRepositories(apiKeyRepositories)
    .withApi(ApiKeyModule)
    .withTransports(apiKeyRest, apiKeyProjectsRest, apiKeyOrganizationsRest, apiKeyTrpcTransport)
    // The credential itself, not just its holder: two of these routes ask whether
    // the KEY may act organization-wide as well as whether the member may, so a
    // narrowed key cannot borrow the reach of whoever created it.
    .provideMiddlewareContext({
      apiKeyRestCredential: (request) => {
        const credential = organizationCredentialOfRequest(request);

        return { apiKeyId: credential.apiKeyId, userId: credential.userId };
      },
      apiKeyIngestionCaller: (request) => {
        const credential = projectCredentialOfRequest(request);

        return {
          principal: principalOfCredential(credential),
          organizationId:
            credential.type === "legacyProjectKey"
              ? credential.project.organizationId
              : credential.organizationId,
        };
      },
    })
    .withEventing(apiKeyEventing);
