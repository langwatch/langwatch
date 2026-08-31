import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  baseResponses,
  resolvePersonalCaller,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";

/**
 * Wire schemas for GET /api/me/usage. Fields mirror the
 * PersonalUsageService output (and the `api.user.personalUsage` tRPC
 * payload the /me dashboard consumes) one-to-one, kept camelCase to
 * match that existing surface so the two entrypoints don't drift.
 */

// Max absolute epoch-ms representable by a JS `Date` (ECMA-262); anything
// beyond becomes `Invalid Date`, so bound the inputs before they reach
// `new Date(...)` in the route handler.
const MAX_DATE_MS = 8_640_000_000_000_000;
const epochMs = z.coerce.number().int().min(-MAX_DATE_MS).max(MAX_DATE_MS);

export const meUsageQuerySchema = z
  .object({
    /** Inclusive window start in epoch ms. Defaults to start-of-month. */
    windowStartMs: epochMs.optional(),
    /** Exclusive window end in epoch ms. Defaults to now. */
    windowEndMs: epochMs.optional(),
  })
  // A half-specified window is ambiguous — require both bounds or neither,
  // rather than silently dropping a lone bound and returning the default month.
  .refine((q) => (q.windowStartMs === undefined) === (q.windowEndMs === undefined), {
    message:
      "windowStartMs and windowEndMs must be provided together (or both omitted for the current month).",
  })
  .refine(
    (q) =>
      q.windowStartMs === undefined ||
      q.windowEndMs === undefined ||
      q.windowStartMs < q.windowEndMs,
    { message: "windowStartMs must be before windowEndMs." },
  );

const mostUsedModelSchema = z.object({ name: z.string(), usagePct: z.number() }).nullable();

const summarySchema = z.object({
  spentUsd: z.number(),
  billedUsd: z.number(),
  requests: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  mostUsedModel: mostUsedModelSchema,
});

const bucketSchema = z.object({
  day: z.string(),
  spentUsd: z.number(),
  billedUsd: z.number(),
  requests: z.number(),
});

const breakdownSchema = z.object({
  label: z.string(),
  spentUsd: z.number(),
  billedUsd: z.number(),
  requests: z.number(),
});

export const meUsageResponseSchema = z.object({
  summary: summarySchema,
  dailyBuckets: z.array(bucketSchema),
  breakdownByModel: z.array(breakdownSchema),
});

/**
 * Wire schema for GET /api/me/project: the identity of the project the
 * calling API key belongs to. Consumed by the CLI's identity notice to
 * name the project behind LANGWATCH_API_KEY.
 */
export const meProjectResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  isPersonal: z.boolean(),
});

/**
 * One person's own AI usage, rolled up over a window: the totals, the per-day
 * buckets and the split by model.
 *
 * The rollup itself is not this feature's to compute — it reads a spend ledger
 * `user` does not own — so it crosses as a capability the process supplies.
 * It is named here rather than imported because the deployment that answers it
 * lives outside this package, and a core feature may not name it.
 */
export interface MePersonalUsageReader {
  personalUsage(input: {
    personalProjectId: string;
    userId?: string;
    ingestionTenantId?: string;
    window?: { startMs: number; endMs: number };
  }): Promise<z.infer<typeof meUsageResponseSchema>>;
}

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
  personalUsage: () => MePersonalUsageReader;
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
    personalUsage: () => MePersonalUsageReader;
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

      return c.json(await services.personalUsage().personalUsage(input));
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
