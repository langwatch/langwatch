/**
 * Routes/schemas/OpenAPI live in the feature package (ADR-128); this composes
 * organization resolution, deep-link builder and unique-constraint decoder.
 */
import { createLogger } from "@langwatch/observability";
import { createPromptsRestApp, type PromptRestService } from "@langwatch/prompt-server";
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
  organizations: () => Pick<OrganizationService, "getTeamById">;
  publicBaseUrl: string | undefined;
}): MountableRestApp {
  return createPromptsRestApp({
    security: options.security,
    prompts: options.prompts,
    ports: {
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
