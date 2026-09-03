/**
 * This process's composition of the packaged prompts REST family
 * (`@langwatch/prompt-server`).
 *
 * The routes, the wire schemas, the OpenAPI declarations and the three refusal
 * mappers live in the feature package (ADR-128). What lives here is everything
 * the family dispatches through that is this process's: the per-route
 * organization resolution, the deep-link builder, and the database client's own
 * unique-constraint decoder.
 *
 * The prompt service arrives as a provider rather than an instance, so a
 * document generator can build this app with none.
 */
import { createLogger } from "@langwatch/observability";
import { createPromptsRestApp, type PromptRestService } from "@langwatch/prompt-server";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { OrganizationService } from "@langwatch/organization-contract";

import {
  createOrganizationMiddleware,
  createPlatformUrlBuilder,
  uniqueConstraintTargets,
} from "../../app/api-rest-ports";

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
  }).hono;
}
