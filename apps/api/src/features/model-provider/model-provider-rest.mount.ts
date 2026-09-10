/**
 * Binds `/api/model-providers` and `/api/model-defaults` to this process's
 * project door, over the SAME `ModelProviderApi` the tRPC surface reads. The
 * cascade family additionally binds the resolved credential as a fact: null
 * for a legacy project key, its owner and organization for an apiKey one —
 * `requireKeyOwner` and `authorizeRequestedScopes` read it to attribute and
 * scope-check a write.
 */
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import {
  modelDefaultsRest,
  modelDefaultsRestCredential,
  modelProviderRest,
} from "@langwatch/model-provider-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/model-providers` and its `/api/v1` twin behind the project door. */
export function mountModelProviderRest(
  runtime: ApiRestRuntime,
  modelProviders: () => ModelProviderApi,
): MountableRestApp {
  return runtime.mount(modelProviderRest.router(), modelProviders);
}

/** Mounts `/api/model-defaults` behind the project door and the resolved credential. */
export function mountModelDefaultsRest(
  runtime: ApiRestRuntime,
  modelProviders: () => ModelProviderApi,
): MountableRestApp {
  return runtime.mount(modelDefaultsRest.router(), modelProviders, {
    facts: [
      bindRestMiddleware(modelDefaultsRestCredential, (context) => {
        const credential = runtime.projectCredentialOf(context.req.raw);
        if (credential.type !== "apiKey") return null;

        return {
          apiKeyId: credential.apiKeyId,
          userId: credential.userId,
          organizationId: credential.organizationId,
        };
      }),
    ],
  });
}
