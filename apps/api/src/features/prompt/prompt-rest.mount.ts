/**
 * Routes/schemas/OpenAPI live in the feature package (ADR-128); this composes
 * organization resolution, deep-link builder and unique-constraint decoder.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  createPromptsRestApp,
  type PromptRestCredential,
  type PromptRestService,
  type PromptTagCatalogAuthorization,
} from "@langwatch/prompt-server";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { OrganizationService } from "@langwatch/organization-contract";

import {
  createOrganizationMiddleware,
  createPlatformUrlBuilder,
  uniqueConstraintTargets,
} from "../../app/api-rest-ports.ts";

const logger = createLogger("langwatch:api:prompts:rest");

/** `/api/prompts`, bound to one process's prompt service. */
export function mountPromptsRest(options: {
  security: AppRestSecurity;
  prompts: () => PromptRestService;
  tagCatalog: () => PromptTagCatalogAuthorization;
  permissions: () => AuthzService;
  organizations: () => Pick<OrganizationService, "getTeamById">;
  publicBaseUrl: string | undefined;
}): MountableRestApp {
  return createPromptsRestApp({
    security: options.security,
    prompts: options.prompts,
    tagCatalog: options.tagCatalog,
    ports: {
      mayManagePromptsIn: ({ credential, projectId }) =>
        credentialMayManagePromptsIn(options.permissions(), credential, projectId),
      organizationMiddleware: createOrganizationMiddleware(options.organizations),
      platformUrl: createPlatformUrlBuilder(options.publicBaseUrl),
      // The nurturing trail a first prompt leaves. LOGGED rather than refused,
      // for the same reason the tRPC half's `afterPromptCreated` is: it is a
      // marketing signal, and refusing would cost somebody the prompt they
      // just wrote. This process composes no product-analytics sink.
      afterPromptCreated: (input) =>
        logger.info(
          { projectId: input.projectId, userId: input.userId ?? null },
          "prompt created; no product-analytics sink is composed on this process",
        ),
      uniqueConstraintTargets,
    },
  });
}

/**
 * The engine's answer for the credential itself: an API key's own bindings
 * intersected with what its owner may still do (ADR-092 §9). A legacy project
 * key names no key row, so it answers only for the project it is pinned to —
 * a write that reaches a sibling project is refused rather than assumed.
 */
async function credentialMayManagePromptsIn(
  permissions: AuthzService,
  credential: PromptRestCredential,
  projectId: string,
): Promise<boolean> {
  if (credential.type === "legacyProjectKey") {
    return credential.projectId === projectId;
  }

  const decision = await permissions.getApiKeyProjectDecision({
    apiKeyId: credential.apiKeyId,
    userId: credential.userId,
    organizationId: credential.organizationId,
    projectId,
    permission: "prompts:manage",
  });
  return decision.outcome === "allowed";
}
