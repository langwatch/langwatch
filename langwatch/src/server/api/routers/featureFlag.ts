import { z } from "zod";
import { createLogger } from "~/utils/logger/server";
import { featureFlagService } from "../../featureFlag";
import { FRONTEND_FEATURE_FLAGS } from "../../featureFlag/frontendFeatureFlags";
import type { FeatureFlagKey } from "../../featureFlag/registry";
import { skipPermissionCheck } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const logger = createLogger("langwatch:feature-flag-router");

const frontendFeatureFlagSchema = z.enum([...FRONTEND_FEATURE_FLAGS] as [
  string,
  ...string[],
]);

/**
 * tRPC router for feature flag checks.
 *
 * Uses PostHog for flag evaluation with optional project/organization targeting.
 * Results are cached server-side (5s TTL) and client-side (React Query).
 *
 * @see dev/docs/adr/005-feature-flags.md for architecture decisions
 */
export const featureFlagRouter = createTRPCRouter({
  /**
   * Check if a feature flag is enabled for the current user.
   *
   * @param flag - The feature flag key (must be in FRONTEND_FEATURE_FLAGS)
   * @param projectId - Optional project ID for project-level targeting
   * @param organizationId - Optional organization ID for org-level targeting
   * @returns { enabled: boolean }
   */
  isEnabled: protectedProcedure
    .input(
      z.object({
        flag: frontendFeatureFlagSchema,
        projectId: z.string().optional(),
        organizationId: z.string().optional(),
      }),
    )
    .use(
      skipPermissionCheck({
        allow: {
          projectId: "for PostHog targeting, not resource access",
          organizationId: "for PostHog targeting, not resource access",
        },
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      logger.debug(
        {
          userId,
          flag: input.flag,
          projectId: input.projectId,
          organizationId: input.organizationId,
        },
        "Feature flag check requested",
      );

      // `input.flag` is runtime-validated against FRONTEND_FEATURE_FLAGS
      // (a subset of registered PRODUCT keys), so the cast is safe;
      // FRONTEND_FEATURE_FLAGS is wider than the inferred zod enum value
      // type, hence the explicit FeatureFlagKey narrowing.
      const enabled = await featureFlagService.isEnabled(
        input.flag as FeatureFlagKey,
        {
          distinctId: userId,
          defaultValue: false,
          projectId: input.projectId,
          organizationId: input.organizationId,
        },
      );

      logger.debug(
        { userId, flag: input.flag, enabled },
        "Feature flag check result",
      );

      return { enabled };
    }),

  /**
   * Check if a feature flag is enabled for ANY of the given organizations.
   *
   * Org-targeted flags can only be evaluated one organization at a time, but
   * some UI (the workspace switcher's personal entry) gates on whether the
   * user has the flag in any organization they belong to. Returns true as
   * soon as one organization has it enabled.
   *
   * The procedure first intersects `organizationIds` with the caller's
   * actual `OrganizationUser` memberships and silently drops the rest —
   * otherwise an authenticated user could probe the flag state of arbitrary
   * organizations they have no business knowing about. Silent drop (rather
   * than throwing on the first unknown id) keeps the response shape
   * indistinguishable between "flag off" and "not a member", so the
   * procedure cannot be used as a membership oracle either.
   *
   * @param flag - The feature flag key (must be in FRONTEND_FEATURE_FLAGS)
   * @param organizationIds - Organizations to evaluate the flag against
   * @returns { enabled: boolean }
   */
  isEnabledForAnyOrganization: protectedProcedure
    .input(
      z.object({
        flag: frontendFeatureFlagSchema,
        organizationIds: z.array(z.string()),
      }),
    )
    // Membership filtering below is the real authorization check; the
    // rbac middleware's sensitive-key guard does not cover plural
    // targeting params and is not relevant here.
    .use(skipPermissionCheck())
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (input.organizationIds.length === 0) {
        return { enabled: false };
      }

      // OrganizationUser is org-scoped under the single-organization
      // invariant of guardOrganizationId, so a single `in:` query would
      // be rejected for spanning multiple orgs. Resolve memberships
      // per-id; the user's org count is bounded by their workspace list.
      const memberships = await Promise.all(
        input.organizationIds.map((organizationId) =>
          ctx.prisma.organizationUser.findUnique({
            where: { userId_organizationId: { userId, organizationId } },
            select: { organizationId: true },
          }),
        ),
      );
      const allowedOrganizationIds = memberships
        .filter((m): m is { organizationId: string } => m !== null)
        .map((m) => m.organizationId);

      if (allowedOrganizationIds.length === 0) {
        return { enabled: false };
      }

      const results = await Promise.all(
        allowedOrganizationIds.map((organizationId) =>
          featureFlagService.isEnabled(input.flag as FeatureFlagKey, {
            distinctId: userId,
            defaultValue: false,
            organizationId,
          }),
        ),
      );

      return { enabled: results.some(Boolean) };
    }),

  /**
   * Per-organization flag state for the given organizations.
   *
   * Like {@link isEnabledForAnyOrganization} but returns the result for EACH
   * organization rather than OR-ing them, so the workspace switcher can nest a
   * personal "My Workspace" entry under exactly the organizations that enable
   * governance (and omit it from the rest).
   *
   * Applies the same membership filtering: organizations the caller does not
   * belong to are silently dropped from the result map (never present as
   * `false`), so the procedure cannot be used as a membership oracle.
   *
   * @param flag - The feature flag key (must be in FRONTEND_FEATURE_FLAGS)
   * @param organizationIds - Organizations to evaluate the flag against
   * @returns { enabledByOrganizationId: Record<string, boolean> }
   */
  isEnabledForEachOrganization: protectedProcedure
    .input(
      z.object({
        flag: frontendFeatureFlagSchema,
        organizationIds: z.array(z.string()),
      }),
    )
    .use(skipPermissionCheck())
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (input.organizationIds.length === 0) {
        return { enabledByOrganizationId: {} as Record<string, boolean> };
      }

      const memberships = await Promise.all(
        input.organizationIds.map((organizationId) =>
          ctx.prisma.organizationUser.findUnique({
            where: { userId_organizationId: { userId, organizationId } },
            select: { organizationId: true },
          }),
        ),
      );
      const allowedOrganizationIds = memberships
        .filter((m): m is { organizationId: string } => m !== null)
        .map((m) => m.organizationId);

      const entries = await Promise.all(
        allowedOrganizationIds.map(
          async (organizationId): Promise<[string, boolean]> => [
            organizationId,
            await featureFlagService.isEnabled(input.flag as FeatureFlagKey, {
              distinctId: userId,
              defaultValue: false,
              organizationId,
            }),
          ],
        ),
      );

      return {
        enabledByOrganizationId: Object.fromEntries(entries) as Record<
          string,
          boolean
        >,
      };
    }),
});
