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
  createConfig,
  deleteConfig,
  setFeatureAtScope,
  setRoleAtScope,
  updateConfig,
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
   * Shape mirrors RBAC: three effective default models for THIS
   * project at the top (the resolver's "what would I actually use
   * here" answer), then a flat list of `ModelDefaultConfig` rows —
   * each carrying its CSS-cascade JSON payload + the scopes it
   * attaches to. The UI groups, filters, or pivots this list itself
   * (per-scope drilldown is a client-side filter, not a separate
   * server call).
   *
   * `available` carries the scopes the caller can write to (RBAC-
   * filtered) so the drawer's chip picker can be the source of truth
   * without a redundant authz check.
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

      // All configs visible from this project's vantage point: any
      // config attached at THIS org / one of its teams / one of its
      // projects. Read-visibility is broader than write-permission —
      // the user can see the whole policy landscape that affects
      // them, even if they can only edit their own scopes.
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

      const visibleScopeFilter = [
        organizationId
          ? { scopeType: "ORGANIZATION" as const, scopeId: organizationId }
          : null,
        allTeamIds.length > 0
          ? { scopeType: "TEAM" as const, scopeId: { in: allTeamIds } }
          : null,
        allProjectIds.length > 0
          ? { scopeType: "PROJECT" as const, scopeId: { in: allProjectIds } }
          : null,
      ].filter(Boolean) as Array<{
        scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
        scopeId: string | { in: string[] };
      }>;

      const configRows =
        visibleScopeFilter.length > 0
          ? await ctx.prisma.modelDefaultConfig.findMany({
              where: {
                scopes: { some: { OR: visibleScopeFilter } },
              },
              select: {
                id: true,
                config: true,
                createdAt: true,
                updatedAt: true,
                authorId: true,
                scopes: {
                  select: {
                    id: true,
                    scopeType: true,
                    scopeId: true,
                  },
                },
              },
              orderBy: { createdAt: "desc" },
            })
          : [];

      // Resolve scope names so the UI can render chips without an
      // extra round trip. Pull only the ids we actually saw.
      const seenTeamIds = Array.from(
        new Set(
          configRows.flatMap((c) =>
            c.scopes
              .filter((s) => s.scopeType === "TEAM")
              .map((s) => s.scopeId),
          ),
        ),
      );
      const seenProjectIds = Array.from(
        new Set(
          configRows.flatMap((c) =>
            c.scopes
              .filter((s) => s.scopeType === "PROJECT")
              .map((s) => s.scopeId),
          ),
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

      // Sort scopes within each config (Organization → Teams →
      // Projects, each alphabetical) so chip render order is stable
      // across reloads.
      const scopeRank = { ORGANIZATION: 0, TEAM: 1, PROJECT: 2 } as const;
      const configs = configRows.map((c) => ({
        id: c.id,
        config: c.config as Record<string, string>,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        authorId: c.authorId,
        scopes: c.scopes
          .map((s) => ({
            type: s.scopeType,
            id: s.scopeId,
            name: scopeName(s.scopeType, s.scopeId),
          }))
          .sort((x, y) => {
            if (x.type !== y.type)
              return scopeRank[x.type] - scopeRank[y.type];
            return x.name.localeCompare(y.name);
          }),
      }));

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
        configs,
        available,
        features: featureProjection,
      };
    }),

  /**
   * Single-key writers used by the provider-create "Set as default"
   * flow and any tactical "change just this role at this scope" UI.
   * Both go through modelDefaults.service which finds the (newest)
   * config attached at the scope and updates the matching key in
   * place, or creates a new config if none exists.
   *
   * Scope-aware authz: org needs organization:manage, team needs
   * team:manage, project needs project:update — same map the
   * provider update mutation uses.
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
      await setRoleAtScope(
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
      await setFeatureAtScope(
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

  /**
   * Full-config writer: save (create or update) a whole policy
   * including its scope attachments. The drawer's "Save" button
   * funnels through here.
   *
   * - `id` omitted → create a new config.
   * - `id` provided → update that config's JSON + scope attachments.
   *
   * Scope-aware authz: the caller must hold the matching manage
   * permission on every scope they are attaching to OR removing from,
   * so a project admin can't silently push a default up to org level.
   */
  saveDefaultModelsConfig: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        config: z.record(z.string()),
        scopes: z
          .array(
            z.object({
              scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
              scopeId: z.string().min(1),
            }),
          )
          .min(1, "Pick at least one scope."),
      }),
    )
    .use(saveConfigPermissionMiddleware)
    .mutation(async ({ input, ctx }) => {
      if (input.id) {
        await updateConfig(
          { prisma: ctx.prisma },
          {
            id: input.id,
            config: input.config,
            scopes: input.scopes,
            authorId: ctx.session?.user?.id ?? null,
          },
        );
        return { id: input.id };
      }
      const created = await createConfig(
        { prisma: ctx.prisma },
        {
          config: input.config,
          scopes: input.scopes,
          authorId: ctx.session?.user?.id ?? null,
        },
      );
      return { id: created.id };
    }),

  /**
   * Delete a config (and all its scope attachments cascade). The
   * caller must hold the matching manage permission on every scope
   * the config is currently attached to.
   */
  deleteDefaultModelsConfig: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(deleteConfigPermissionMiddleware)
    .mutation(async ({ input, ctx }) => {
      await deleteConfig({ prisma: ctx.prisma }, input.id);
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
 * Permission middleware for saveDefaultModelsConfig. Iterates every
 * scope in the desired attachment set + every scope being removed (on
 * an update) and asserts the caller can write each one. Setting
 * `ctx.permissionChecked = true` is required by the permission-builder
 * contract — without it `enforcePermissionCheck` throws.
 */
async function saveConfigPermissionMiddleware({
  ctx,
  input,
  next,
}: {
  ctx: any;
  input: {
    id?: string;
    scopes: Array<{
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>;
  };
  next: () => Promise<unknown>;
}): Promise<unknown> {
  for (const s of input.scopes) {
    await assertCanWriteScope(ctx, s.scopeType, s.scopeId);
  }
  if (input.id) {
    const existing = await ctx.prisma.modelDefaultConfigScope.findMany({
      where: { configId: input.id },
      select: { scopeType: true, scopeId: true },
    });
    const desired = new Set(
      input.scopes.map((s) => `${s.scopeType}::${s.scopeId}`),
    );
    const removed = existing.filter(
      (e: { scopeType: string; scopeId: string }) =>
        !desired.has(`${e.scopeType}::${e.scopeId}`),
    );
    for (const r of removed) {
      await assertCanWriteScope(
        ctx,
        r.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
        r.scopeId,
      );
    }
  }
  ctx.permissionChecked = true;
  return next();
}

/**
 * Permission middleware for deleteDefaultModelsConfig. Reads the
 * config's current scope attachments and asserts the caller can write
 * each one — deleting a config the caller can't fully manage would
 * remove rules at scopes they don't own.
 */
async function deleteConfigPermissionMiddleware({
  ctx,
  input,
  next,
}: {
  ctx: any;
  input: { id: string };
  next: () => Promise<unknown>;
}): Promise<unknown> {
  const scopes = await ctx.prisma.modelDefaultConfigScope.findMany({
    where: { configId: input.id },
    select: { scopeType: true, scopeId: true },
  });
  for (const s of scopes) {
    await assertCanWriteScope(
      ctx,
      s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
      s.scopeId,
    );
  }
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

