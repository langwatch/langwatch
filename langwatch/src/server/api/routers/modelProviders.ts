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
   * Rich snapshot for the Default Models settings page: per-role effective
   * resolution for the project, plus the raw role-level value at each scope
   * so the line UI can render "from organization" / "from team" hints and
   * let admins flip the value at any scope they can manage.
   */
  getDefaultModelsForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const project = await ctx.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, teamId: true, team: { select: { organizationId: true } } },
      });
      if (!project) {
        throw new Error("Project not found");
      }
      const teamId = project.teamId;
      const organizationId = project.team?.organizationId ?? null;

      const features = allFeatures();

      // Resolve the effective model per role using a feature from that role
      // as a proxy (the resolver's role-level walk is shared across all
      // features in a role — we just need one feature per role to read it).
      const featureProxyByRole: Partial<Record<ModelRole, string>> = {};
      for (const role of MODEL_ROLES) {
        const f = features.find((x) => x.role === role);
        if (f) featureProxyByRole[role] = f.key;
      }

      const roles = await Promise.all(
        MODEL_ROLES.map(async (role) => {
          const proxyFeatureKey = featureProxyByRole[role];
          let effective: {
            model: string;
            source: string;
            scope: string | null;
          } | null = null;
          if (proxyFeatureKey) {
            try {
              const r = await resolveModelForFeature(proxyFeatureKey, {
                prisma: ctx.prisma,
                projectId,
              });
              effective = { model: r.model, source: r.source, scope: r.scope };
            } catch {
              effective = null;
            }
          }
          // Raw role-level value at each scope (null = not set, falls back).
          const [orgRow, teamRow, projectRow] = await Promise.all([
            organizationId
              ? ctx.prisma.modelDefault.findFirst({
                  where: {
                    scopeType: "ORGANIZATION",
                    scopeId: organizationId,
                    role,
                    featureKey: null,
                  },
                  select: { model: true },
                })
              : Promise.resolve(null),
            teamId
              ? ctx.prisma.modelDefault.findFirst({
                  where: {
                    scopeType: "TEAM",
                    scopeId: teamId,
                    role,
                    featureKey: null,
                  },
                  select: { model: true },
                })
              : Promise.resolve(null),
            ctx.prisma.modelDefault.findFirst({
              where: {
                scopeType: "PROJECT",
                scopeId: projectId,
                role,
                featureKey: null,
              },
              select: { model: true },
            }),
          ]);

          // Per-feature: effective resolution + per-scope override rows.
          const roleFeatures = features.filter((f) => f.role === role);
          const featureRows = await Promise.all(
            roleFeatures.map(async (f) => {
              let featEffective: {
                model: string;
                source: string;
                scope: string | null;
              } | null = null;
              try {
                const r = await resolveModelForFeature(f.key, {
                  prisma: ctx.prisma,
                  projectId,
                });
                featEffective = {
                  model: r.model,
                  source: r.source,
                  scope: r.scope,
                };
              } catch {
                featEffective = null;
              }
              const [oRow, tRow, pRow] = await Promise.all([
                organizationId
                  ? ctx.prisma.modelDefault.findFirst({
                      where: {
                        scopeType: "ORGANIZATION",
                        scopeId: organizationId,
                        role,
                        featureKey: f.key,
                      },
                      select: { model: true },
                    })
                  : Promise.resolve(null),
                teamId
                  ? ctx.prisma.modelDefault.findFirst({
                      where: {
                        scopeType: "TEAM",
                        scopeId: teamId,
                        role,
                        featureKey: f.key,
                      },
                      select: { model: true },
                    })
                  : Promise.resolve(null),
                ctx.prisma.modelDefault.findFirst({
                  where: {
                    scopeType: "PROJECT",
                    scopeId: projectId,
                    role,
                    featureKey: f.key,
                  },
                  select: { model: true },
                }),
              ]);
              return {
                key: f.key,
                displayName: f.displayName,
                description: f.description,
                effective: featEffective,
                perScope: {
                  organization: oRow?.model ?? null,
                  team: tRow?.model ?? null,
                  project: pRow?.model ?? null,
                },
              };
            }),
          );

          return {
            role,
            effective,
            perScope: {
              organization: orgRow?.model ?? null,
              team: teamRow?.model ?? null,
              project: projectRow?.model ?? null,
            },
            features: featureRows,
          };
        }),
      );

      return {
        projectId,
        teamId,
        organizationId,
        roles,
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

