import { PersonalUsageService } from "@ee/governance/services/personalUsage.service";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import {
  createProjectApp,
  requires,
  type SecuredApp,
} from "~/server/api/security";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";

import type { AuthMiddlewareVariables } from "../../middleware/auth";
import { baseResponses } from "../../shared/base-responses";
import { meUsageQuerySchema, meUsageResponseSchema } from "./schemas";

patchZodOpenapi();

/**
 * Hono app for /api/me — the personal-developer surface. Today it
 * exposes a single read: GET /api/me/usage, the same spend / usage /
 * model-breakdown payload the /me dashboard renders via the
 * `api.user.personalUsage` tRPC procedure. Both entrypoints call the
 * shared PersonalUsageService so the numbers stay identical across the
 * web dashboard and any external client (desktop widget, CLI, CI).
 *
 * Auth: a project API key whose project is the caller's personal
 * project (Project.isPersonal=true). The owner is resolved from
 * Project.ownerUserId; usage is keyed by (personalProjectId, ownerUserId)
 * exactly as the tRPC procedure keys it, so ingestion-source ledger
 * traffic (Claude Code OTLP, etc.) is unioned in the same way.
 */
const secured = createProjectApp({ basePath: "/api/me" });

registerMeRoutes(secured);

export function registerMeRoutes(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  secured.access(requires("project:view")).get(
    "/usage",
    describeRoute({
      description:
        "Personal AI usage for the current month (or an explicit window): spend, billed spend, request + token counts, per-day buckets, and per-model breakdown. Requires a personal-project API key.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(meUsageResponseSchema),
            },
          },
        },
      },
    }),
    zValidator("query", meUsageQuerySchema),
    async (c) => {
      const project = c.get("project");

      // /api/me/usage is principal-scoped: it only makes sense for a
      // personal project, where ownerUserId identifies whose usage to
      // roll up. A shared/team project key has no single owner, so we
      // reject it rather than guess.
      if (!project.isPersonal || !project.ownerUserId) {
        throw new HTTPException(400, {
          message:
            "GET /api/me/usage requires a personal-project API key (Project.isPersonal must be true). Use the API key from your personal workspace.",
        });
      }

      // Ownership guard: a user-bound key must own the personal project it
      // targets. A legacy project key has no `apiKeyUserId` — it is that
      // project's own key, so the caller is the owner by construction.
      const callerUserId = c.get("apiKeyUserId");
      if (callerUserId && callerUserId !== project.ownerUserId) {
        throw new HTTPException(403, {
          message:
            "This API key cannot read another user's personal usage. Use a key scoped to your own personal workspace.",
        });
      }

      const { windowStartMs, windowEndMs } = c.req.valid("query");
      const window =
        windowStartMs !== undefined && windowEndMs !== undefined
          ? { start: new Date(windowStartMs), end: new Date(windowEndMs) }
          : undefined;

      const usage = new PersonalUsageService();
      const input = {
        personalProjectId: project.id,
        userId: project.ownerUserId,
        window,
      };

      // Independent rollups — CH multiplexes them happily.
      const [summary, dailyBuckets, breakdownByModel] = await Promise.all([
        usage.summary(input),
        usage.dailyBuckets(input),
        usage.breakdownByModel(input),
      ]);

      return c.json({ summary, dailyBuckets, breakdownByModel });
    },
  );
}

export const app = secured.hono;
