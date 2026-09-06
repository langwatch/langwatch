import { findHiddenGovernanceProject } from "@ee/governance/services/governanceProject.service";
import { PersonalUsageService } from "@ee/governance/services/personalUsage.service";
import { describeRoute, resolver } from "hono-openapi";
import {
  createProjectApp,
  requires,
  type SecuredApp,
} from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";

import type { AuthMiddlewareVariables } from "../../middleware/auth";
import { baseResponses } from "../../shared/base-responses";
import { resolvePersonalCaller } from "../../shared/personal-project-caller";
import {
  meProjectResponseSchema,
  meUsageQuerySchema,
  meUsageResponseSchema,
} from "./schemas";

patchZodOpenapi();

/**
 * Hono app for /api/me — the personal-developer surface. Two reads:
 *
 *   GET /api/me/usage    — the same spend / usage / model-breakdown payload
 *                          the /me dashboard renders via the
 *                          `api.user.personalUsage` tRPC procedure. Both
 *                          entrypoints call the shared PersonalUsageService
 *                          so the numbers stay identical across the web
 *                          dashboard and any external client (desktop
 *                          widget, CLI, CI).
 *   GET /api/me/project  — identity of the project the calling key belongs
 *                          to (any project key, not only personal). The
 *                          CLI's identity notice names the project behind
 *                          LANGWATCH_API_KEY with it.
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
  registerUsageRoute(secured);
  registerProjectRoute(secured);
}

function registerUsageRoute(
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

      // /api/me/usage is principal-scoped: it only makes sense for a personal
      // workspace, whose owner identifies whose usage to roll up. Both guards
      // and both refusals are shared with the coding agent's pull-request
      // usage read, which needs a person for the same reason.
      const ownerUserId = resolvePersonalCaller({
        project,
        apiKeyUserId: c.get("apiKeyUserId"),
      });

      const { windowStartMs, windowEndMs } = c.req.valid("query");
      const window =
        windowStartMs !== undefined && windowEndMs !== undefined
          ? { start: new Date(windowStartMs), end: new Date(windowEndMs) }
          : undefined;

      // Ingestion-source ledger rows (Claude Code OTLP, etc.) land under
      // the org's hidden Governance Project tenant, not the personal
      // project. Resolve it read-only (never provision on a GET) so the
      // usage union is scoped to THIS org's tenant — both to prune
      // ClickHouse partitions and to avoid summing a multi-org user's
      // spend across every org. Absent when the org never minted an
      // ingestion source, in which case there is no ledger traffic.
      const team = await prisma.team.findUnique({
        where: { id: project.teamId },
        select: { organizationId: true },
      });
      const governanceProject = team
        ? await findHiddenGovernanceProject({
            prisma,
            organizationId: team.organizationId,
          })
        : null;

      const usage = PersonalUsageService.create(
        getApp().governance.personalUsage,
      );
      const input = {
        personalProjectId: project.id,
        userId: ownerUserId,
        ingestionTenantId: governanceProject?.id,
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

function registerProjectRoute(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  secured.access(requires("project:view")).get(
    "/project",
    describeRoute({
      description:
        "Identity of the project the calling API key belongs to: id, name, slug and whether it is a personal workspace project. Lets a client (the CLI's identity notice, a widget) say which project a key targets without any further access.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(meProjectResponseSchema),
            },
          },
        },
      },
    }),
    (c) => {
      const project = c.get("project");
      return c.json({
        id: project.id,
        name: project.name,
        slug: project.slug,
        isPersonal: project.isPersonal === true,
      });
    },
  );
}

export const app = secured.hono;
