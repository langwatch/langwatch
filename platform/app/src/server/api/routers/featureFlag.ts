import {
  authenticatedFeatureFlagTargetInputSchema,
  experimentCatalogueEntrySchema,
  experimentTenantPolicySchema,
  experimentTenantScopeSchema,
  frontendFeatureFlagMapSchema,
  frontendFeatureFlagSchema,
  type AuthenticatedExperimentTarget,
  type ExperimentCatalogueEntry,
  type FrontendFeatureFlag,
} from "@langwatch/feature-flag-contract";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Session } from "~/server/auth";
import { authorizeInResolver } from "../rbac";
import { createTRPCRouter, protectedProcedure, type TRPCContext } from "../trpc";

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

type AuthenticatedTRPCContext = TRPCContext & { session: Session };
type TargetInput = z.infer<typeof authenticatedFeatureFlagTargetInputSchema>;

const authorizesExactTarget = authorizeInResolver({
  projectId:
    "the resolver authorizes project:view on this exact project and checks its organization",
  organizationId: "the resolver authorizes organization:view on this exact organization",
});

const managesExactScope = authorizeInResolver({
  projectId: "the resolver authorizes featureFlags:manageExperiments on this exact project",
  organizationId:
    "the resolver authorizes featureFlags:manageExperiments on this exact organization",
});

export const featureFlagRouter = createTRPCRouter({
  isEnabled: protectedProcedure
    .input(legacyFlagInputSchema)
    .noPermission({
      reason: "the resolver authorizes any tenant target before evaluating the caller's flag",
      allow: {
        projectId: "authorized by authorizeLegacyTarget",
        organizationId: "authorized by authorizeLegacyTarget",
      },
    })
    .output(enabledOutputSchema)
    .query(async ({ ctx, input }) => {
      const target = await authorizeLegacyTarget(ctx, input);
      const enabled = await ctx.app.featureFlags.isEnabled(input.flag, target);

      return { enabled };
    }),

  isEnabledForAnyOrganization: protectedProcedure
    .input(organizationFlagsInputSchema)
    .noPermission({
      reason: "the resolver filters every organization through the caller's membership",
    })
    .output(enabledOutputSchema)
    .query(async ({ ctx, input }) => {
      const byOrganization = await resolveForMemberOrganizations({
        ctx,
        flag: input.flag,
        organizationIds: input.organizationIds,
      });

      return { enabled: Object.values(byOrganization).some(Boolean) };
    }),

  isEnabledForEachOrganization: protectedProcedure
    .input(organizationFlagsInputSchema)
    .noPermission({
      reason: "the resolver filters every organization through the caller's membership",
    })
    .output(enabledByOrganizationOutputSchema)
    .query(async ({ ctx, input }) => {
      const enabledByOrganizationId = await resolveForMemberOrganizations({
        ctx,
        flag: input.flag,
        organizationIds: input.organizationIds,
      });

      return { enabledByOrganizationId };
    }),

  resolve: protectedProcedure
    .input(targetInputSchema)
    .use(authorizesExactTarget)
    .output(resolvedFlagsOutputSchema)
    .query(async ({ ctx, input }) => {
      const target = await authorizeTarget(ctx, input.target);
      const flags = await ctx.app.featureFlags.resolveFrontendFlags(target);

      return { flags };
    }),

  experiments: protectedProcedure
    .input(targetInputSchema)
    .use(authorizesExactTarget)
    .output(experimentsOutputSchema)
    .query(async ({ ctx, input }) => {
      const target = await authorizeTarget(ctx, input.target);
      const entries = await ctx.app.featureFlags.resolveExperimentCatalogue(target);
      const experiments = await stripUnauthorizedPolicies(ctx, target, entries);

      return { experiments };
    }),

  setExperimentEnrolment: protectedProcedure
    .input(enrolmentInputSchema)
    .use(authorizesExactTarget)
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

  setExperimentTenantPolicy: protectedProcedure
    .input(tenantPolicyInputSchema)
    .use(managesExactScope)
    .output(mutationOutputSchema)
    .mutation(async ({ ctx, input }) => {
      await authorizeTenantPolicyChange(ctx, input.scope);
      await ctx.app.featureFlags.setExperimentTenantPolicy({
        flagKey: input.flag,
        scope: input.scope,
        policy: input.policy,
        changedByUserId: ctx.session.user.id,
      });

      return { ok: true } as const;
    }),
});

async function authorizeTarget(
  ctx: AuthenticatedTRPCContext,
  target: TargetInput,
): Promise<AuthenticatedExperimentTarget> {
  const userId = ctx.session.user.id;

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

async function authorizeLegacyTarget(
  ctx: AuthenticatedTRPCContext,
  input: { projectId?: string; organizationId?: string },
): Promise<AuthenticatedExperimentTarget> {
  const userId = ctx.session.user.id;

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

async function resolveForMemberOrganizations({
  ctx,
  flag,
  organizationIds,
}: {
  ctx: AuthenticatedTRPCContext;
  flag: FrontendFeatureFlag;
  organizationIds: string[];
}): Promise<Record<string, boolean>> {
  const userId = ctx.session.user.id;
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

async function stripUnauthorizedPolicies(
  ctx: AuthenticatedTRPCContext,
  target: AuthenticatedExperimentTarget,
  entries: ExperimentCatalogueEntry[],
): Promise<ExperimentCatalogueEntry[]> {
  const userId = ctx.session.user.id;
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
  ctx: AuthenticatedTRPCContext,
  scope: z.infer<typeof experimentTenantScopeSchema>,
): Promise<void> {
  const permitted = await ctx.app.permissions.hasPermission({
    userId: ctx.session.user.id,
    permission: "featureFlags:manageExperiments",
    ...(scope.kind === "project"
      ? { projectId: scope.projectId }
      : { organizationId: scope.organizationId }),
  });
  if (!permitted) {
    throw forbidden("Not permitted to manage experiments for this scope.");
  }
}

async function authorizeProjectView(
  ctx: AuthenticatedTRPCContext,
  projectId: string,
): Promise<void> {
  const permitted = await ctx.app.permissions.hasPermission({
    userId: ctx.session.user.id,
    permission: "project:view",
    projectId,
  });
  if (!permitted) {
    throw forbidden("Not permitted for this project.");
  }
}

async function authorizeOrganizationView(
  ctx: AuthenticatedTRPCContext,
  organizationId: string,
): Promise<void> {
  const permitted = await ctx.app.permissions.hasPermission({
    userId: ctx.session.user.id,
    permission: "organization:view",
    organizationId,
  });
  if (!permitted) {
    throw forbidden("Not permitted for this organization.");
  }
}

function forbidden(message: string): TRPCError {
  return new TRPCError({ code: "FORBIDDEN", message });
}
