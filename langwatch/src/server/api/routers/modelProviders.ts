import type { ModelDefaultScopeType } from "@prisma/client";
import { z } from "zod";
import { customModelUpdateInputSchema } from "../../modelProviders/customModel.schema";
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
import { buildSeedPlanForProvider } from "../../modelProviders/seedOnboardingDefaults";
import {
  checkOrganizationPermission,
  checkProjectPermission,
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
  listProjectModelProvidersForFrontend,
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
  /**
   * List shape: one entry per stored ModelProvider row, no collapsing
   * by provider key. Use this for surfaces that need to render every
   * row (the settings page Model Providers table) rather than the
   * narrowest-scope-per-provider view returned by
   * `getAllForProjectForFrontend`. Multi-instance setups (e.g. two
   * "OpenAI" rows at different scopes) appear as two distinct entries.
   */
  listAllForProjectForFrontend: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input }) => {
      return await listProjectModelProvidersForFrontend(input.projectId);
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
  /**
   * Cascade-resolve a single feature key for a project. Wraps
   * `resolveModelForFeature` for frontend consumers that used to read
   * `project.defaultModel` / etc directly. Returns null when nothing
   * is configured at any scope rather than throwing, so the caller can
   * render a placeholder selector + a "configure a default" hint
   * without an exception-based control flow.
   */
  getResolvedDefault: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        featureKey: z.string(),
      }),
    )
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      if (!featureByKey(input.featureKey)) {
        return null;
      }
      try {
        const resolved = await resolveModelForFeature(input.featureKey, {
          prisma: ctx.prisma,
          projectId: input.projectId,
        });
        return {
          model: resolved.model,
          source: resolved.source,
          scope: resolved.scope,
        };
      } catch {
        return null;
      }
    }),

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

      // Read-visibility is built from scopes the caller can actually
      // *read*, not the union of every scope in the organization. A
      // project-only viewer must not receive policy rows attached to
      // sibling teams / projects they have no read permission on —
      // doing so leaks the org-wide policy landscape and the names of
      // its scopes to anyone with project:view on a single project.
      const canReadOrg =
        !!organizationId &&
        (await hasOrganizationPermission(
          ctx,
          organizationId,
          "organization:view",
        ));
      let readableTeamIds: string[] = [];
      let readableProjectIds: string[] = [projectId];
      if (organizationId) {
        const orgTeams = await ctx.prisma.team.findMany({
          where: { organizationId },
          select: { id: true },
        });
        const teamRead = await Promise.all(
          orgTeams.map(async (t) => ({
            id: t.id,
            readable: await hasTeamPermission(ctx, t.id, "team:view"),
          })),
        );
        readableTeamIds = teamRead.filter((t) => t.readable).map((t) => t.id);

        const orgProjects = await ctx.prisma.project.findMany({
          where: { team: { organizationId } },
          select: { id: true },
        });
        const projectRead = await Promise.all(
          orgProjects.map(async (p) => ({
            id: p.id,
            readable: await hasProjectPermission(ctx, p.id, "project:view"),
          })),
        );
        readableProjectIds = projectRead
          .filter((p) => p.readable)
          .map((p) => p.id);
      } else if (teamId) {
        const teamReadable = await hasTeamPermission(ctx, teamId, "team:view");
        if (teamReadable) readableTeamIds = [teamId];
      }

      const visibleScopeFilter = [
        canReadOrg && organizationId
          ? { scopeType: "ORGANIZATION" as const, scopeId: organizationId }
          : null,
        readableTeamIds.length > 0
          ? { scopeType: "TEAM" as const, scopeId: { in: readableTeamIds } }
          : null,
        readableProjectIds.length > 0
          ? { scopeType: "PROJECT" as const, scopeId: { in: readableProjectIds } }
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

  /**
   * "What would the cascade hand back for these scopes if I had no
   * value here?" — drives the drawer's inherited-as-placeholder + the
   * "Inherit (from organization) [openai/gpt-5.5]" dropdown entry.
   *
   * The cascade walk is computed for the most-specific picked scope
   * (project beats team beats org), excluding any config attached to
   * the picked scopes themselves (and, when editing, optionally an
   * `excludeConfigId` so the in-progress draft is treated as "not
   * yet saved"). For each role + each registered feature key, the
   * response carries the model the cascade would resolve to + the
   * scope tier it came from.
   *
   * When the cascade has nothing AND there's a provider visible to
   * the caller that could fulfill a role, the response surfaces an
   * `inferred` suggestion from the registry's latest-flagship /
   * mini / embedding heuristic — same logic the onboarding seed
   * uses. The drawer can show this as the dropdown's first entry so
   * the user always has SOMETHING to pick, even on a brand-new
   * organization.
   */
  getInheritedValuesForScopes: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scopes: z
          .array(
            z.object({
              scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
              scopeId: z.string().min(1),
            }),
          )
          .min(1, "Pick at least one scope."),
        excludeConfigId: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      // Build a per-key map of {model, source, scope?} the cascade
      // would resolve to for each role + feature key, if no value
      // were set on the picked scopes themselves. This is deliberately
      // ONE answer per key — the resolution at runtime is per-scope,
      // but the drawer surfaces a single "if you inherit, here's what
      // you'd get" hint that's good enough for the user to decide.
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
        select: {
          id: true,
          teamId: true,
          team: { select: { organizationId: true } },
        },
      });
      if (!project) throw new Error("Project not found");
      const teamId = project.teamId;
      const organizationId = project.team?.organizationId ?? null;

      // The cascade we want to surface is "what would a project see
      // inside the most-specific picked scope". Pick the most-specific
      // tier in the picked set (PROJECT beats TEAM beats ORGANIZATION).
      const tierRank = { PROJECT: 0, TEAM: 1, ORGANIZATION: 2 } as const;
      const sortedPicked = [...input.scopes].sort(
        (a, b) => tierRank[a.scopeType] - tierRank[b.scopeType],
      );
      const referenceScope = sortedPicked[0]!;

      // Resolve the chain that "anchors" the cascade walk. For a
      // picked PROJECT scope, anchor is that project's team + org.
      // For a TEAM, anchor is the team itself + its org. For an
      // ORGANIZATION, only the org tier matters.
      let chainTeamId: string | null = null;
      let chainOrganizationId: string | null = null;
      if (referenceScope.scopeType === "PROJECT") {
        const refProject = await ctx.prisma.project.findUnique({
          where: { id: referenceScope.scopeId },
          select: {
            teamId: true,
            team: { select: { organizationId: true } },
          },
        });
        chainTeamId = refProject?.teamId ?? null;
        chainOrganizationId = refProject?.team?.organizationId ?? null;
      } else if (referenceScope.scopeType === "TEAM") {
        const refTeam = await ctx.prisma.team.findUnique({
          where: { id: referenceScope.scopeId },
          select: { organizationId: true },
        });
        chainTeamId = referenceScope.scopeId;
        chainOrganizationId = refTeam?.organizationId ?? null;
      } else {
        chainOrganizationId = referenceScope.scopeId;
      }

      // Build the set of (scopeType, scopeId) pairs to exclude from
      // the cascade — the picked scopes themselves are treated as
      // "not yet set" so we surface what the user would inherit.
      const excludedScopes = new Set(
        input.scopes.map((s) => `${s.scopeType}::${s.scopeId}`),
      );

      // Tiers to walk: PROJECT (referenceScope if it's a project) →
      // TEAM (chainTeamId) → ORGANIZATION (chainOrganizationId).
      const tiers: Array<{
        tier: "project" | "team" | "organization";
        scopeType: ModelDefaultScopeType;
        scopeId: string;
      }> = [];
      if (
        referenceScope.scopeType === "PROJECT" &&
        !excludedScopes.has(`PROJECT::${referenceScope.scopeId}`)
      ) {
        tiers.push({
          tier: "project",
          scopeType: "PROJECT",
          scopeId: referenceScope.scopeId,
        });
      }
      if (chainTeamId && !excludedScopes.has(`TEAM::${chainTeamId}`)) {
        tiers.push({
          tier: "team",
          scopeType: "TEAM",
          scopeId: chainTeamId,
        });
      }
      if (
        chainOrganizationId &&
        !excludedScopes.has(`ORGANIZATION::${chainOrganizationId}`)
      ) {
        tiers.push({
          tier: "organization",
          scopeType: "ORGANIZATION",
          scopeId: chainOrganizationId,
        });
      }

      // Pull every config attached at any tier in the walk. Exclude
      // configs the caller is editing (excludeConfigId) and configs
      // whose ONLY attachment is to an excluded scope (so a multi-
      // scope config that ALSO attaches to a non-excluded scope
      // still contributes — the resolver doesn't care about the
      // attachment we're ignoring, just whether any attachment
      // hits the walk's tier).
      const tierScopeIds = tiers.map((t) => ({
        scopeType: t.scopeType,
        scopeId: t.scopeId,
      }));
      const candidateConfigs =
        tierScopeIds.length > 0
          ? await ctx.prisma.modelDefaultConfig.findMany({
              where: {
                AND: [
                  input.excludeConfigId
                    ? { id: { not: input.excludeConfigId } }
                    : {},
                  { scopes: { some: { OR: tierScopeIds } } },
                ],
              },
              select: {
                id: true,
                config: true,
                createdAt: true,
                scopes: {
                  select: { scopeType: true, scopeId: true },
                },
              },
            })
          : [];

      // Helper: read a string value from a config's JSON.
      const readKey = (cfg: unknown, key: string): string | null => {
        if (typeof cfg !== "object" || cfg === null) return null;
        const v = (cfg as Record<string, unknown>)[key];
        return typeof v === "string" && v.length > 0 ? v : null;
      };

      // Walk the cascade for a single key (role or feature key).
      // Returns the first hit, tier-by-tier specificity, within-tier
      // by createdAt DESC.
      type Hit = {
        model: string;
        source: "feature_override" | "role_default";
        scope: "project" | "team" | "organization";
      };
      const walkKey = (key: string, isFeatureKey: boolean): Hit | null => {
        for (const t of tiers) {
          const attached = candidateConfigs
            .filter((c) =>
              c.scopes.some(
                (s) =>
                  s.scopeType === t.scopeType && s.scopeId === t.scopeId,
              ),
            )
            .sort(
              (a, b) =>
                b.createdAt.getTime() - a.createdAt.getTime(),
            );
          for (const c of attached) {
            const value = readKey(c.config, key);
            if (value) {
              return {
                model: value,
                source: isFeatureKey ? "feature_override" : "role_default",
                scope: t.tier,
              };
            }
          }
        }
        return null;
      };

      // Inference fallback: when cascade returns nothing for a role,
      // and there's a provider enabled at any visible scope, suggest
      // the registry's latest-flagship / mini / embedding for that
      // role. Reuses buildSeedPlanForProvider — same heuristic the
      // onboarding seed uses, so a fresh org's "Inherit" placeholder
      // matches what they'd see if they re-ran the seed.
      const providers = organizationId
        ? await ctx.prisma.modelProvider.findMany({
            where: {
              enabled: true,
              scopes: {
                some: {
                  OR: [
                    { scopeType: "ORGANIZATION", scopeId: organizationId },
                    teamId
                      ? { scopeType: "TEAM", scopeId: teamId }
                      : { scopeType: "TEAM", scopeId: "__none__" },
                    { scopeType: "PROJECT", scopeId: input.projectId },
                  ],
                },
              },
            },
            select: { provider: true, scopes: { select: { scopeType: true } } },
            orderBy: { createdAt: "asc" },
          })
        : [];
      const inferenceProvider = providers[0]?.provider;
      const inferencePlan = inferenceProvider
        ? buildSeedPlanForProvider(inferenceProvider)
        : {};

      // Build the response. One entry per role; one entry per feature
      // key. For features the cascade walk targets the feature key
      // first; the role's value is the fallback.
      const features = allFeatures();
      const inherited: Record<
        string,
        {
          model: string;
          source: "feature_override" | "role_default" | "inferred";
          scope: "project" | "team" | "organization" | null;
          inferredFromProvider?: string;
        } | null
      > = {};

      for (const role of MODEL_ROLES) {
        const hit = walkKey(role, false);
        if (hit) {
          inherited[role] = hit;
          continue;
        }
        const inferredModel = (inferencePlan as Record<string, string | undefined>)[
          role
        ];
        if (inferredModel && inferenceProvider) {
          inherited[role] = {
            model: inferredModel,
            source: "inferred",
            scope: null,
            inferredFromProvider: inferenceProvider,
          };
          continue;
        }
        inherited[role] = null;
      }

      for (const f of features) {
        // For a feature key: the cascade can have either the feature
        // key itself OR the role default. Feature-key match wins.
        const featureHit = walkKey(f.key, true);
        if (featureHit) {
          inherited[f.key] = featureHit;
          continue;
        }
        // Fall back to whatever the role inherits — keeps the dropdown
        // saying "Inherit (from organization)" for a feature row even
        // when only the role default is set higher up the chain.
        const roleHit = inherited[f.role];
        if (roleHit) {
          inherited[f.key] = roleHit;
          continue;
        }
        inherited[f.key] = null;
      }

      return {
        inherited,
        // Echo the reference scope so the UI can confirm which scope
        // the inheritance preview was computed against. Useful when
        // the picked set is heterogeneous and the user wonders why
        // "(from organization)" rather than "(from team)".
        referenceScope: {
          scopeType: referenceScope.scopeType,
          scopeId: referenceScope.scopeId,
        },
      };
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

