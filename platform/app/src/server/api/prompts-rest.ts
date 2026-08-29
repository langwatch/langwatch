/**
 * This process's composition of the packaged prompts REST family
 * (`@langwatch/prompt-server`).
 *
 * The routes, the wire schemas, the OpenAPI declarations and the three refusal
 * mappers live in the feature package (ADR-128). What lives here is everything
 * the family dispatches through that is this process's: the REST security
 * spine, the per-route organization resolution, the deep-link builder, the
 * product-analytics trail a first prompt leaves, and the database client's own
 * unique-constraint decoder.
 *
 * The prompt service arrives as a provider rather than an instance, so the
 * OpenAPI generator can build this app with none.
 */
import {
  createPromptsRestApp,
  type PromptAppVariables,
  type PromptRestService,
} from "@langwatch/prompt-server";
import type { Hono } from "hono";

import { organizationMiddleware } from "~/app/api/middleware/organization";
import { platformUrl } from "~/app/api/shared/platform-url";
import { appRestSecurity } from "~/server/api/security";
import { afterPromptCreated } from "~/server/app-layer/billing/nurturing/promptCreation";
import { prisma } from "~/server/db";
import { uniqueConstraintTargets } from "~/server/utils/prismaErrors";

/** `/api/prompts`, bound to one process's prompt service. */
export function buildPromptsRestApp(
  prompts: () => PromptRestService,
): Hono<{ Variables: PromptAppVariables }> {
  return createPromptsRestApp({
    security: appRestSecurity,
    prompts,
    ports: {
      organizationMiddleware,
      platformUrl,
      afterPromptCreated: (input) => afterPromptCreated({ prisma, ...input }),
      uniqueConstraintTargets,
    },
  }).hono;
}
