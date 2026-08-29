import type { GovernanceApp } from "@langwatch/enterprise-api";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { describeRoute, resolver } from "hono-openapi";

import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  baseResponses,
  resolvePersonalCaller,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import {
  meProjectResponseSchema,
  meUsageQuerySchema,
  meUsageResponseSchema,
} from "./me-rest.schemas";

/**
 * Resolving the organization behind a personal workspace when the credential
 * did not name one.
 *
 * Not on the `OrganizationService` contract today, so it is named here rather
 * than assumed: the concrete service already answers it, and a process passing
 * anything else has to say so. It belongs on the contract — moving it there is
 * a change to the organization package, not to a transport move.
 */
export interface MeRestTeamOrganizationLookup {
  getOrganizationIdByTeamId(teamId: string): Promise<string | null>;
}

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
export function createMeRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading them off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  governance: () => GovernanceApp;
  organizations: () => OrganizationService & MeRestTeamOrganizationLookup;
  projects: () => ProjectService;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const secured = options.security.createProjectApp({ basePath: "/api/me" });

  registerUsageRoute(secured, options);
  registerProjectRoute(secured);

  return secured;
}

function registerUsageRoute(
  secured: SecuredApp<{ Variables: AppRestProjectVariables }>,
  services: {
    governance: () => GovernanceApp;
    organizations: () => OrganizationService & MeRestTeamOrganizationLookup;
    projects: () => ProjectService;
  },
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
          ? { startMs: windowStartMs, endMs: windowEndMs }
          : undefined;

      // Ingestion-source ledger rows (Claude Code OTLP, etc.) land under
      // the org's hidden Governance Project tenant, not the personal
      // project. Resolve it read-only (never provision on a GET) so the
      // usage union is scoped to THIS org's tenant — both to prune
      // ClickHouse partitions and to avoid summing a multi-org user's
      // spend across every org. Absent when the org never minted an
      // ingestion source, in which case there is no ledger traffic.
      const organizationId =
        c.get("apiKeyOrganizationId") ??
        (await services.organizations().getOrganizationIdByTeamId(project.teamId));
      const governanceProject = organizationId
        ? await services.projects().tryFindInternal({
            organizationId,
            kind: "internal_governance",
          })
        : null;

      const input = {
        personalProjectId: project.id,
        userId: ownerUserId,
        ingestionTenantId: governanceProject?.id,
        window,
      };

      return c.json(await services.governance().personalUsage(input));
    },
  );
}

function registerProjectRoute(secured: SecuredApp<{ Variables: AppRestProjectVariables }>): void {
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
        isPersonal: project.isPersonal,
      });
    },
  );
}
