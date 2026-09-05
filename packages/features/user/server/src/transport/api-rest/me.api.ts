import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { Context } from "hono";
import { z } from "zod";

import {
  type AppRestSecurity,
  baseResponses,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  resolvePersonalCaller,
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
  organizations: () => OrganizationService;
  projects: () => ProjectService;
}): MountableRestApp {
  const { service, policy } = options.security.createProjectVersionedApp({
    name: "me",
    basePath: "/api/me",
    errorEnvelope: "legacy",
    // A request-schema failure reaches the process's renderer as a bare
    // zod-shaped error, which carries no status of its own.
  });

  const view = policy("project:view");

  const usageHandler = async (c: Context, input: z.infer<typeof meUsageQuerySchema>) => {
    const project = c.get("project");

    // /api/me/usage is principal-scoped: it only makes sense for a personal
    // workspace, whose owner identifies whose usage to roll up. Both guards
    // and both refusals are shared with the coding agent's pull-request
    // usage read, which needs a person for the same reason.
    const ownerUserId = resolvePersonalCaller({
      project,
      apiKeyUserId: c.get("apiKeyUserId"),
    });

    const window =
      input.windowStartMs !== undefined && input.windowEndMs !== undefined
        ? { startMs: input.windowStartMs, endMs: input.windowEndMs }
        : undefined;

    // Ingestion-source ledger rows (Claude Code OTLP, etc.) land under the
    // org's hidden Governance Project tenant, not the personal project.
    // Resolve it read-only (never provision on a GET) so the usage union is
    // scoped to THIS org's tenant — both to prune ClickHouse partitions and to
    // avoid summing a multi-org user's spend across every org. Absent when the
    // org never minted an ingestion source, in which case there is no ledger
    // traffic.
    const organizationId =
      c.get("apiKeyOrganizationId") ??
      (await options.organizations().tryGetOrganizationIdByTeamId({ teamId: project.teamId }));
    const governanceProject = organizationId
      ? await options.projects().tryFindInternal({
          organizationId,
          kind: "internal_governance",
        })
      : null;

    return options.personalUsage().personalUsage({
      personalProjectId: project.id,
      userId: ownerUserId,
      ...(governanceProject ? { ingestionTenantId: governanceProject.id } : {}),
      ...(window ? { window } : {}),
    });
  };

  const projectHandler = (c: Context) => {
    const project = c.get("project");
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      isPersonal: project.isPersonal,
    };
  };

  return service
    .registerRoute("get", "/usage", MANAGEMENT_API_VERSION, usageHandler, (b) =>
      view(b)
        .withQuery(meUsageQuerySchema)
        .withOutput(meUsageResponseSchema)
        .withDocs({
          operationId: "getMyUsage",
          tags: ["Me"],
          description:
            "Personal AI usage for the current month (or an explicit window): spend, billed spend, request + token counts, per-day buckets, and per-model breakdown. Requires a personal-project API key.",
          responses: { ...baseResponses },
        }),
    )
    .registerRoute("get", "/project", MANAGEMENT_API_VERSION, projectHandler, (b) =>
      view(b)
        .withOutput(meProjectResponseSchema)
        .withDocs({
          operationId: "getMyProject",
          tags: ["Me"],
          description:
            "Identity of the project the calling API key belongs to: id, name, slug and whether it is a personal workspace project. Lets a client (the CLI's identity notice, a widget) say which project a key targets without any further access.",
          responses: { ...baseResponses },
        }),
    )
    .build();
}
