import { z } from "zod";
import { customModelUpdateInputSchema } from "../../modelProviders/customModel.schema";
import { DefaultModelsService } from "../../modelProviders/defaultModels.service";
import {
  allFeatures,
  featureByKey,
  MODEL_ROLES,
  type ModelRole,
} from "../../modelProviders/featureRegistry";
import {
  setFeatureOverride,
  setRoleAssignment,
} from "../../modelProviders/modelDefaults.service";
import { ModelProviderService } from "../../modelProviders/modelProvider.service";
import { resolveModelForFeature } from "../../modelProviders/resolveModelForFeature";
import {
  checkProjectPermission,
  checkOrganizationPermission,
  checkTeamPermission,
  hasOrganizationPermission,
  hasProjectPermission,
  hasTeamPermission,
} from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  validateKeyWithCustomUrl,
  validateProviderApiKey,
} from "./providerValidation";
import {
  getProjectModelProviders,
  getProjectModelProvidersForFrontend,
} from "./modelProviders.utils";
import { isManagedProvider } from "../../../../ee/managed-providers/managedBedrockConfig";

export type { ModelMetadataForFrontend } from "./modelProviders.utils";
export {
  getProjectModelProviders,
  getModelMetadataForFrontend,
  mergeCustomModelMetadata,
  getProjectModelProvidersForFrontend,
  prepareEnvKeys,
  prepareLitellmParams,
} from "./modelProviders.utils";

export const modelProviderRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;

      const hasSetupPermission = await hasProjectPermission(
        ctx,
        projectId,
        "project:update",
      );

      return await getProjectModelProviders(projectId, hasSetupPermission);
    }),
  getAllForProjectForFrontend: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const hasSetupPermission = await hasProjectPermission(
        ctx,
        projectId,
        "project:update",
      );
      return await getProjectModelProvidersForFrontend(
        projectId,
        hasSetupPermission,
      );
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.string(),
        provider: z.string(),
        // Human-readable label shown in the settings list and the model
        // selector group headers. Defaults to the humanized provider name
        // (e.g. "openai" → "OpenAI") when omitted. Iter 109 added the
        // column; now exposing it on the write path so operators can
        // distinguish multiple same-provider instances at different
        // scopes.
        name: z.string().trim().min(1).max(128).optional(),
        enabled: z.boolean(),
        customKeys: z.object({}).passthrough().optional().nullable(),
        customModels: customModelUpdateInputSchema.optional().nullable(),
        customEmbeddingsModels: customModelUpdateInputSchema.optional().nullable(),
        extraHeaders: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional()
          .nullable(),
        defaultModel: z.string().optional(),
        // Multi-scope writes (iter 109). `scopes` is the canonical shape;
        // `scopeType`/`scopeId` remain for the transition period so older
        // callers still compile. When both arrive, `scopes` wins. The
        // service runs the fail-closed authz check on every entry before
        // persisting — any non-manageable scope aborts the whole write.
        scopes: z
          .array(
            z.object({
              scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
              scopeId: z.string().min(1),
            }),
          )
          .min(1, "At least one scope must be selected.")
          .optional(),
        scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]).optional(),
        scopeId: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      const service = ModelProviderService.create(ctx.prisma);
      return await service.updateModelProvider(
        {
          id: input.id,
          projectId: input.projectId,
          provider: input.provider,
          name: input.name,
          enabled: input.enabled,
          customKeys: input.customKeys as
            | Record<string, unknown>
            | null
            | undefined,
          customModels: input.customModels,
          customEmbeddingsModels: input.customEmbeddingsModels,
          extraHeaders: input.extraHeaders,
          defaultModel: input.defaultModel,
          scopes: input.scopes,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        },
        { prisma: ctx.prisma, session: ctx.session },
      );
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.string(),
        provider: z.string(),
      }),
    )
    .use(checkProjectPermission("project:delete"))
    .mutation(async ({ input, ctx }) => {
      const service = ModelProviderService.create(ctx.prisma);
      return await service.deleteModelProvider(input, {
        prisma: ctx.prisma,
        session: ctx.session,
      });
    }),

  /**
   * Validates an API key for a given model provider.
   * This is a read-only query that tests if the provided API key works
   */
  validateApiKey: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        provider: z.string(),
        customKeys: z.record(z.string()),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .query(async ({ input }) => {
      const { provider, customKeys } = input;
      return validateProviderApiKey(provider, customKeys);
    }),

  isManagedProvider: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        provider: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(({ input }) => {
      return { managed: isManagedProvider(input.organizationId, input.provider) };
    }),

  /**
   * Validates a stored or env var API key against a custom or default base URL.
   * Gets API key from DB or env var and validates against the provided URL (or default if not provided).
   */
  validateKeyWithCustomUrl: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        provider: z.string(),
        customBaseUrl: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .query(async ({ input, ctx }) => {
      const { projectId, provider, customBaseUrl } = input;
      return validateKeyWithCustomUrl(
        projectId,
        provider,
        customBaseUrl,
        ctx.prisma,
      );
    }),

  // ────────────────────────────────────────────────────────────────────────
  // Hierarchical default models (page-level section, redesigned out of the
  // create/edit provider drawer). Resolution walks project → team → org →
  // built-in constant; each scope has its own setter so RBAC is checked at
  // the scope the caller is writing to.
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Returns the effective default models for a project (with the resolved
   * source scope per field) plus the raw per-scope values so the UI can
   * render scope-aware selectors and inheritance hints.
   */
  getEffectiveDefaultModels: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const service = DefaultModelsService.create(ctx.prisma);
      return service.getForProject(input.projectId);
    }),

  setOrganizationDefaultModels: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        defaultModel: z.string().nullable().optional(),
        topicClusteringModel: z.string().nullable().optional(),
        embeddingsModel: z.string().nullable().optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const service = DefaultModelsService.create(ctx.prisma);
      const { organizationId, ...values } = input;
      return service.setForScope({
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        values,
      });
    }),

  setTeamDefaultModels: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        defaultModel: z.string().nullable().optional(),
        topicClusteringModel: z.string().nullable().optional(),
        embeddingsModel: z.string().nullable().optional(),
      }),
    )
    .use(checkTeamPermission("team:manage"))
    .mutation(async ({ input, ctx }) => {
      const service = DefaultModelsService.create(ctx.prisma);
      const { teamId, ...values } = input;
      return service.setForScope({
        scopeType: "TEAM",
        scopeId: teamId,
        values,
      });
    }),

  setProjectDefaultModels: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        defaultModel: z.string().nullable().optional(),
        topicClusteringModel: z.string().nullable().optional(),
        embeddingsModel: z.string().nullable().optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      const service = DefaultModelsService.create(ctx.prisma);
      const { projectId, ...values } = input;
      return service.setForScope({
        scopeType: "PROJECT",
        scopeId: projectId,
        values,
      });
    }),

  // ────────────────────────────────────────────────────────────────────────
  // Role + feature-keyed default models (Area B3.2). Writes go through
  // Mario's `modelDefaults.service` so they land in the new `ModelDefault`
  // table; the legacy Organization/Team/Project scalar columns become
  // read-only fallback during the compat window.
  // See specs/model-providers/role-based-default-models.feature.
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Snapshot for the Default Models settings page.
   *
   * Shape mirrors RBAC: the top of the page renders three "current
   * default" lines (one per role) showing the effective resolution for
   * THIS project; everything else is a flat `assignments` list of
   * principal-style policy rows — `{ role, featureKey?, model, scopes:
   * [...] }` — where one logical row can mix organization / team /
   * project scopes that share the same model.
   *
   * Storage stays one ModelDefault row per scope (so the resolver walk
   * is unchanged). The server groups rows by (role, featureKey, model)
   * before returning so the UI can render multi-scope assignments as
   * one chip-picker row. `available` carries the picker options the
   * caller is allowed to write to (RBAC-filtered).
   */
  getDefaultModelsForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const project = await ctx.prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          teamId: true,
          team: {
            select: {
              organizationId: true,
              organization: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!project) {
        throw new Error("Project not found");
      }
      const teamId = project.teamId;
      const organizationId = project.team?.organizationId ?? null;
      const organizationName = project.team?.organization?.name ?? null;

      const features = allFeatures();

      // Effective resolution per role (drives the three top-of-page
      // lines). Uses one feature per role as a proxy — the resolver's
      // role-level walk is shared across all features in a role.
      const effective: Record<
        ModelRole,
        { model: string; source: string; scope: string | null } | null
      > = { DEFAULT: null, FAST: null, EMBEDDINGS: null };
      for (const role of MODEL_ROLES) {
        const proxy = features.find((x) => x.role === role);
        if (!proxy) continue;
        try {
          const r = await resolveModelForFeature(proxy.key, {
            prisma: ctx.prisma,
            projectId,
          });
          effective[role] = {
            model: r.model,
            source: r.source,
            scope: r.scope,
          };
        } catch {
          effective[role] = null;
        }
      }

      // Available scopes for the override drawer's chip picker. Limited
      // to scopes the caller can write at: org needs organization:manage,
      // team needs team:manage, project needs project:update. The drawer
      // hides chips the caller can't act on so we never invite a write
      // that would 403 on save.
      let canWriteOrg = false;
      let writableTeams: { id: string; name: string }[] = [];
      let writableProjects: { id: string; name: string; teamId: string }[] = [];
      if (organizationId) {
        canWriteOrg = await hasOrganizationPermission(
          ctx,
          organizationId,
          "organization:manage",
        );
        const orgTeams = await ctx.prisma.team.findMany({
          where: { organizationId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        const teamWritable = await Promise.all(
          orgTeams.map(async (t) => ({
            ...t,
            writable: await hasTeamPermission(ctx, t.id, "team:manage"),
          })),
        );
        writableTeams = teamWritable
          .filter((t) => t.writable)
          .map(({ id, name }) => ({ id, name }));

        const orgProjects = await ctx.prisma.project.findMany({
          where: { team: { organizationId } },
          select: { id: true, name: true, teamId: true },
          orderBy: { name: "asc" },
        });
        const projectWritable = await Promise.all(
          orgProjects.map(async (p) => ({
            ...p,
            writable: await hasProjectPermission(ctx, p.id, "project:update"),
          })),
        );
        writableProjects = projectWritable
          .filter((p) => p.writable)
          .map(({ id, name, teamId }) => ({ id, name, teamId }));
      } else {
        // Personal-account project (no org/team): only project scope.
        const writable = await hasProjectPermission(
          ctx,
          projectId,
          "project:update",
        );
        if (writable) {
          writableProjects = [
            {
              id: projectId,
              name: (
                await ctx.prisma.project.findUnique({
                  where: { id: projectId },
                  select: { name: true },
                })
              )?.name ?? projectId,
              teamId: teamId ?? "",
            },
          ];
        }
      }
      const available = {
        organization:
          canWriteOrg && organizationId
            ? { id: organizationId, name: organizationName ?? organizationId }
            : null,
        teams: writableTeams,
        projects: writableProjects,
      };

      // All ModelDefault rows in scope for this org/project. We fetch
      // by scope IDs the caller's view can see (the org's teams and
      // projects, plus the org itself) so the overrides list shows
      // every assignment that affects this org — readability isn't
      // RBAC-gated even when writability is.
      const allTeamIds = organizationId
        ? (
            await ctx.prisma.team.findMany({
              where: { organizationId },
              select: { id: true },
            })
          ).map((t) => t.id)
        : teamId
          ? [teamId]
          : [];
      const allProjectIds = organizationId
        ? (
            await ctx.prisma.project.findMany({
              where: { team: { organizationId } },
              select: { id: true },
            })
          ).map((p) => p.id)
        : [projectId];

      const visibleRows = await ctx.prisma.modelDefault.findMany({
        where: {
          OR: [
            organizationId
              ? { scopeType: "ORGANIZATION", scopeId: organizationId }
              : null,
            allTeamIds.length > 0
              ? { scopeType: "TEAM", scopeId: { in: allTeamIds } }
              : null,
            allProjectIds.length > 0
              ? { scopeType: "PROJECT", scopeId: { in: allProjectIds } }
              : null,
          ].filter(Boolean) as any[],
        },
        select: {
          id: true,
          scopeType: true,
          scopeId: true,
          role: true,
          featureKey: true,
          model: true,
        },
      });

      // Resolve names so the UI can render chips without an extra round
      // trip. Pull only the IDs we actually saw rows for.
      const seenTeamIds = Array.from(
        new Set(
          visibleRows
            .filter((r) => r.scopeType === "TEAM")
            .map((r) => r.scopeId),
        ),
      );
      const seenProjectIds = Array.from(
        new Set(
          visibleRows
            .filter((r) => r.scopeType === "PROJECT")
            .map((r) => r.scopeId),
        ),
      );
      const [seenTeams, seenProjects] = await Promise.all([
        seenTeamIds.length > 0
          ? ctx.prisma.team.findMany({
              where: { id: { in: seenTeamIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([] as { id: string; name: string }[]),
        seenProjectIds.length > 0
          ? ctx.prisma.project.findMany({
              where: { id: { in: seenProjectIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([] as { id: string; name: string }[]),
      ]);
      const teamNameById = new Map(seenTeams.map((t) => [t.id, t.name]));
      const projectNameById = new Map(
        seenProjects.map((p) => [p.id, p.name]),
      );
      const scopeName = (
        scopeType: "ORGANIZATION" | "TEAM" | "PROJECT",
        scopeId: string,
      ): string => {
        if (scopeType === "ORGANIZATION")
          return organizationName ?? scopeId;
        if (scopeType === "TEAM") return teamNameById.get(scopeId) ?? scopeId;
        return projectNameById.get(scopeId) ?? scopeId;
      };

      // Group by (role, featureKey ?? "", model). One group = one logical
      // assignment shown as a single row in the UI.
      type AssignmentScope = {
        type: "ORGANIZATION" | "TEAM" | "PROJECT";
        id: string;
        name: string;
      };
      type Assignment = {
        id: string;
        role: ModelRole;
        featureKey: string | null;
        model: string;
        scopes: AssignmentScope[];
      };
      const groups = new Map<string, Assignment>();
      for (const row of visibleRows) {
        const role = row.role as ModelRole;
        const featureKey = row.featureKey;
        const key = `${role}::${featureKey ?? ""}::${row.model}`;
        const scope: AssignmentScope = {
          type: row.scopeType as AssignmentScope["type"],
          id: row.scopeId,
          name: scopeName(
            row.scopeType as AssignmentScope["type"],
            row.scopeId,
          ),
        };
        const existing = groups.get(key);
        if (existing) {
          existing.scopes.push(scope);
        } else {
          groups.set(key, {
            id: key,
            role,
            featureKey,
            model: row.model,
            scopes: [scope],
          });
        }
      }
      // Stable order: role-level assignments first (featureKey null), then
      // per-feature, both sorted by model name for diff-friendly output.
      const assignments = Array.from(groups.values()).sort((a, b) => {
        if (a.role !== b.role)
          return MODEL_ROLES.indexOf(a.role) - MODEL_ROLES.indexOf(b.role);
        const af = a.featureKey ?? "";
        const bf = b.featureKey ?? "";
        if (af !== bf) return af.localeCompare(bf);
        return a.model.localeCompare(b.model);
      });

      // Sort scopes within each assignment so the chip render order is
      // stable across reloads (Organization → Teams → Projects, each
      // alphabetical).
      const scopeRank = { ORGANIZATION: 0, TEAM: 1, PROJECT: 2 } as const;
      for (const a of assignments) {
        a.scopes.sort((x, y) => {
          if (x.type !== y.type) return scopeRank[x.type] - scopeRank[y.type];
          return x.name.localeCompare(y.name);
        });
      }

      const featureProjection = features.map((f) => ({
        key: f.key,
        role: f.role,
        displayName: f.displayName,
        description: f.description,
      }));

      return {
        projectId,
        teamId,
        organizationId,
        organizationName,
        effective,
        assignments,
        available,
        features: featureProjection,
      };
    }),

  /**
   * Set or clear the role-level default model at a scope. Clearing
   * (model=null) deletes the `ModelDefault` row and lets the resolver fall
   * back to the next scope up; setting writes to the new table only —
   * never to the legacy Organization/Team/Project scalar columns.
   * Scope-aware authz lives in the inline middleware below.
   */
  setRoleAssignmentForScope: protectedProcedure
    .input(
      z.object({
        scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
        scopeId: z.string(),
        role: z.enum(MODEL_ROLES),
        model: z.string().nullable(),
      }),
    )
    .use(scopeAwarePermissionMiddleware)
    .mutation(async ({ input, ctx }) => {
      await setRoleAssignment(
        { prisma: ctx.prisma },
        {
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          role: input.role,
          model: input.model,
          authorId: ctx.session?.user?.id ?? null,
        },
      );
      return { ok: true };
    }),

  /**
   * Set or clear a per-feature override at a scope. The feature key must
   * exist in the registry — its role is read from the registry so the row
   * carries the right role tag for the resolver's walk.
   */
  setFeatureOverrideForScope: protectedProcedure
    .input(
      z.object({
        scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
        scopeId: z.string(),
        featureKey: z.string(),
        model: z.string().nullable(),
      }),
    )
    .use(scopeAwarePermissionMiddleware)
    .mutation(async ({ input, ctx }) => {
      if (!featureByKey(input.featureKey)) {
        throw new Error(`Unknown feature key: "${input.featureKey}".`);
      }
      await setFeatureOverride(
        { prisma: ctx.prisma },
        {
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          featureKey: input.featureKey,
          model: input.model,
          authorId: ctx.session?.user?.id ?? null,
        },
      );
      return { ok: true };
    }),
});

/**
 * Permission middleware for the role/feature default writers. Each scope
 * demands its matching permission so a project admin can't silently push
 * a role default up to the organization scope. Matches the per-scope
 * permission map the existing model-providers update mutation uses.
 */
async function scopeAwarePermissionMiddleware({
  ctx,
  input,
  next,
}: {
  ctx: any;
  input: { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string };
  next: () => Promise<unknown>;
}): Promise<unknown> {
  await assertCanWriteScope(ctx, input.scopeType, input.scopeId);
  ctx.permissionChecked = true;
  return next();
}

/**
 * RBAC guard for the role/feature default writers. Each scope demands a
 * different permission so a project admin can't silently push a role
 * default up to the organization scope. Mirrors the model-providers
 * update mutation's scope-aware authz.
 */
async function assertCanWriteScope(
  ctx: any,
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT",
  scopeId: string,
): Promise<void> {
  if (!ctx.session?.user?.id) {
    throw new Error("Not authenticated");
  }
  if (scopeType === "ORGANIZATION") {
    if (
      !(await hasOrganizationPermission(ctx, scopeId, "organization:manage"))
    ) {
      throw new Error("Missing organization:manage permission");
    }
    return;
  }
  if (scopeType === "TEAM") {
    if (!(await hasTeamPermission(ctx, scopeId, "team:manage"))) {
      throw new Error("Missing team:manage permission");
    }
    return;
  }
  // PROJECT
  if (!(await hasProjectPermission(ctx, scopeId, "project:update"))) {
    throw new Error("Missing project:update permission");
  }
}

