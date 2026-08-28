import type { AuthzService } from "@langwatch/authz-contract";
import {
  authenticatedFeatureFlagTargetInputSchema,
  experimentCatalogueEntrySchema,
  experimentTenantPolicySchema,
  experimentTenantScopeSchema,
  frontendFeatureFlagMapSchema,
  frontendFeatureFlagSchema,
  type AuthenticatedExperimentTarget,
  type AuthenticatedFeatureFlagTargetInput,
  type ExperimentCatalogueEntry,
  type ExperimentTenantScope,
  type FeatureFlagService,
  type FrontendFeatureFlag,
} from "@langwatch/feature-flag-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

/**
 * The collaborators feature flag transport needs, each narrowed to the one
 * capability it uses: the flag service itself, the permission decisions that
 * authorize a tenant target, the project's owning organization, and the
 * membership filter the legacy per-organization procedures apply.
 */
type FeatureFlagApplication = Readonly<{
  featureFlags: FeatureFlagService;
  permissions: Pick<AuthzService, "hasPermission">;
  projects: Readonly<{ getOrganizationId(projectId: string): Promise<string> }>;
  organizations: Readonly<{
    isMember(input: { organizationId: string; userId: string }): Promise<boolean>;
  }>;
}>;

/** The process supplies authentication, audit and error policy. */
export type FeatureFlagTrpcContext = Readonly<{
  app: FeatureFlagApplication;
  actor(): Readonly<{ id: string }>;
}>;

type FeatureFlagTrpcProcedures<
  TContext extends FeatureFlagTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
}>;

const legacyFlagInputSchema = z
  .object({
    flag: frontendFeatureFlagSchema,
    projectId: z.string().optional(),
    organizationId: z.string().optional(),
  })
  .strict();
const organizationFlagsInputSchema = z
  .object({
    flag: frontendFeatureFlagSchema,
    organizationIds: z.array(z.string()),
  })
  .strict();
const targetInputSchema = z.object({ target: authenticatedFeatureFlagTargetInputSchema }).strict();
const enrolmentInputSchema = z
  .object({
    flag: frontendFeatureFlagSchema,
    target: authenticatedFeatureFlagTargetInputSchema,
    enrolled: z.boolean(),
  })
  .strict();
const tenantPolicyInputSchema = z
  .object({
    flag: frontendFeatureFlagSchema,
    scope: experimentTenantScopeSchema,
    policy: experimentTenantPolicySchema,
  })
  .strict();

const enabledOutputSchema = z.object({ enabled: z.boolean() }).strict();
const enabledByOrganizationOutputSchema = z
  .object({ enabledByOrganizationId: z.record(z.string(), z.boolean()) })
  .strict();
const resolvedFlagsOutputSchema = z.object({ flags: frontendFeatureFlagMapSchema }).strict();
const experimentsOutputSchema = z
  .object({ experiments: z.array(experimentCatalogueEntrySchema) })
  .strict();
const mutationOutputSchema = z.object({ ok: z.literal(true) }).strict();

function forbidden(message: string): TRPCError {
  return new TRPCError({ code: "FORBIDDEN", message });
}

async function authorizeProjectView(ctx: FeatureFlagTrpcContext, projectId: string): Promise<void> {
  const permitted = await ctx.app.permissions.hasPermission({
    userId: ctx.actor().id,
    permission: "project:view",
    projectId,
  });
  if (!permitted) {
    throw forbidden("Not permitted for this project.");
  }
}

async function authorizeOrganizationView(
  ctx: FeatureFlagTrpcContext,
  organizationId: string,
): Promise<void> {
  const permitted = await ctx.app.permissions.hasPermission({
    userId: ctx.actor().id,
    permission: "organization:view",
    organizationId,
  });
  if (!permitted) {
    throw forbidden("Not permitted for this organization.");
  }
}

/**
 * The exact tenant target the caller asked for, authorized at its own tier.
 * A project is checked against the organization it actually belongs to, so a
 * caller cannot pair a project with an organization it is not in.
 */
async function authorizeTarget(
  ctx: FeatureFlagTrpcContext,
  target: AuthenticatedFeatureFlagTargetInput,
): Promise<AuthenticatedExperimentTarget> {
  const userId = ctx.actor().id;

  if (target.kind === "user") {
    return { kind: "user", userId };
  }

  if (target.kind === "organization") {
    await authorizeOrganizationView(ctx, target.organizationId);

    return { kind: "organization", userId, organizationId: target.organizationId };
  }

  await authorizeProjectView(ctx, target.projectId);
  const organizationId = await ctx.app.projects.getOrganizationId(target.projectId);
  if (organizationId !== target.organizationId) {
    throw forbidden("The project does not belong to that organization.");
  }

  return {
    kind: "project",
    userId,
    projectId: target.projectId,
    organizationId,
  };
}

/** The compatibility target shape: optional ids rather than a tagged union. */
async function authorizeLegacyTarget(
  ctx: FeatureFlagTrpcContext,
  input: { projectId?: string; organizationId?: string },
): Promise<AuthenticatedExperimentTarget> {
  const userId = ctx.actor().id;

  if (input.projectId) {
    await authorizeProjectView(ctx, input.projectId);
    const organizationId = await ctx.app.projects.getOrganizationId(input.projectId);
    if (input.organizationId && organizationId !== input.organizationId) {
      throw forbidden("The project does not belong to that organization.");
    }

    return { kind: "project", userId, projectId: input.projectId, organizationId };
  }

  if (input.organizationId) {
    await authorizeOrganizationView(ctx, input.organizationId);

    return { kind: "organization", userId, organizationId: input.organizationId };
  }

  return { kind: "user", userId };
}

/**
 * Evaluates only the organizations the caller belongs to, and omits the rest
 * rather than answering false for them: a present-and-false entry would turn
 * the procedure into a membership oracle.
 */
async function resolveForMemberOrganizations({
  ctx,
  flag,
  organizationIds,
}: {
  ctx: FeatureFlagTrpcContext;
  flag: FrontendFeatureFlag;
  organizationIds: string[];
}): Promise<Record<string, boolean>> {
  const userId = ctx.actor().id;
  const entries = await Promise.all(
    organizationIds.map(async (organizationId) => {
      const member = await ctx.app.organizations.isMember({ organizationId, userId });
      if (!member) {
        return void 0;
      }

      const enabled = await ctx.app.featureFlags.isEnabled(flag, {
        kind: "organization",
        userId,
        organizationId,
      });

      return [organizationId, enabled] as const;
    }),
  );

  return Object.fromEntries(entries.filter((entry) => entry !== undefined));
}

/** Tenant policies are manager data; a viewer sees the entry without them. */
async function stripUnauthorizedPolicies(
  ctx: FeatureFlagTrpcContext,
  target: AuthenticatedExperimentTarget,
  entries: ExperimentCatalogueEntry[],
): Promise<ExperimentCatalogueEntry[]> {
  const userId = ctx.actor().id;
  const canManageProject =
    target.kind === "project" &&
    (await ctx.app.permissions.hasPermission({
      userId,
      permission: "featureFlags:manageExperiments",
      projectId: target.projectId,
    }));
  const canManageOrganization =
    (target.kind === "project" || target.kind === "organization") &&
    (await ctx.app.permissions.hasPermission({
      userId,
      permission: "featureFlags:manageExperiments",
      organizationId: target.organizationId,
    }));

  return entries.map((entry) => {
    const { projectPolicy, organizationPolicy, ...viewerEntry } = entry;

    return {
      ...viewerEntry,
      ...(canManageProject && projectPolicy ? { projectPolicy } : {}),
      ...(canManageOrganization && organizationPolicy ? { organizationPolicy } : {}),
    };
  });
}

async function authorizeTenantPolicyChange(
  ctx: FeatureFlagTrpcContext,
  scope: ExperimentTenantScope,
): Promise<void> {
  const permitted = await ctx.app.permissions.hasPermission({
    userId: ctx.actor().id,
    permission: "featureFlags:manageExperiments",
    ...(scope.kind === "project"
      ? { projectId: scope.projectId }
      : { organizationId: scope.organizationId }),
  });
  if (!permitted) {
    throw forbidden("Not permitted to manage experiments for this scope.");
  }
}

/**
 * Installs the complete `featureFlag.*` tRPC surface on a process-owned root.
 * The procedure is injected by the process so its audit, error, logging and
 * tracing policies wrap every feature procedure consistently; the tenant
 * authorization below is the feature's own and travels with it.
 */
export class FeatureFlagTrpcApi {
  static create<
    TContext extends FeatureFlagTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: FeatureFlagTrpcProcedures<TContext, TOptions, TRoot> = {
      protected: trpc.procedure,
    },
  ) {
    const procedure = procedures.protected;

    return trpc.router({
      isEnabled: procedure
        .input(legacyFlagInputSchema)
        .output(enabledOutputSchema)
        .query(async ({ ctx, input }) => {
          const target = await authorizeLegacyTarget(ctx, input);
          const enabled = await ctx.app.featureFlags.isEnabled(input.flag, target);

          return { enabled };
        }),

      isEnabledForAnyOrganization: procedure
        .input(organizationFlagsInputSchema)
        .output(enabledOutputSchema)
        .query(async ({ ctx, input }) => {
          const byOrganization = await resolveForMemberOrganizations({
            ctx,
            flag: input.flag,
            organizationIds: input.organizationIds,
          });

          return { enabled: Object.values(byOrganization).some(Boolean) };
        }),

      isEnabledForEachOrganization: procedure
        .input(organizationFlagsInputSchema)
        .output(enabledByOrganizationOutputSchema)
        .query(async ({ ctx, input }) => {
          const enabledByOrganizationId = await resolveForMemberOrganizations({
            ctx,
            flag: input.flag,
            organizationIds: input.organizationIds,
          });

          return { enabledByOrganizationId };
        }),

      resolve: procedure
        .input(targetInputSchema)
        .output(resolvedFlagsOutputSchema)
        .query(async ({ ctx, input }) => {
          const target = await authorizeTarget(ctx, input.target);
          const flags = await ctx.app.featureFlags.resolveFrontendFlags(target);

          return { flags };
        }),

      experiments: procedure
        .input(targetInputSchema)
        .output(experimentsOutputSchema)
        .query(async ({ ctx, input }) => {
          const target = await authorizeTarget(ctx, input.target);
          const entries = await ctx.app.featureFlags.resolveExperimentCatalogue(target);
          const experiments = await stripUnauthorizedPolicies(ctx, target, entries);

          return { experiments };
        }),

      setExperimentEnrolment: procedure
        .input(enrolmentInputSchema)
        .output(mutationOutputSchema)
        .mutation(async ({ ctx, input }) => {
          const target = await authorizeTarget(ctx, input.target);
          await ctx.app.featureFlags.setUserExperimentEnrolment({
            flagKey: input.flag,
            target,
            enrolled: input.enrolled,
          });

          return { ok: true } as const;
        }),

      setExperimentTenantPolicy: procedure
        .input(tenantPolicyInputSchema)
        .output(mutationOutputSchema)
        .mutation(async ({ ctx, input }) => {
          const actorId = ctx.actor().id;
          await authorizeTenantPolicyChange(ctx, input.scope);
          await ctx.app.featureFlags.setExperimentTenantPolicy({
            flagKey: input.flag,
            scope: input.scope,
            policy: input.policy,
            changedByUserId: actorId,
          });

          return { ok: true } as const;
        }),
    });
  }
}
