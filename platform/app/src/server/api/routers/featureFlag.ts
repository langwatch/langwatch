import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { featureFlagService } from "../../featureFlag";
import { FRONTEND_FEATURE_FLAGS } from "../../featureFlag/frontendFeatureFlags";
import type { FeatureFlagKey } from "../../featureFlag/registry";
import { NOT_TARGETED } from "../../featureFlag/targeting";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const logger = createLogger("langwatch:feature-flag-router");

const frontendFeatureFlagSchema = z.enum([...FRONTEND_FEATURE_FLAGS] as [
  string,
  ...string[],
]);

/**
 * tRPC router for feature flag checks.
 *
 * Resolves through the in-code registry and the operator flag store. Every
 * read states the project and the organization it is about, so targeting
 * rules can match.
 * Results are cached server-side (5s TTL) and client-side (React Query).
 *
 * @see dev/docs/adr/005-feature-flags.md for architecture decisions
 */
export const featureFlagRouter = createTRPCRouter({
  /**
   * Check if a feature flag is enabled for the current user.
   *
   * Both targeting fields are required on the wire, and `null` states that
   * the calling surface has no such scope. An optional field would let a
   * caller drop the organization by accident, and an organization rule would
   * then match nothing. JSON has no `undefined`, so `null` also carries the
   * "not known yet" case; the client disables the query in that case.
   *
   * @param flag - The feature flag key (must be in FRONTEND_FEATURE_FLAGS)
   * @param projectId - Project ID for project-level targeting, or null
   * @param organizationId - Organization ID for org-level targeting, or null
   * @returns { enabled: boolean }
   */
  isEnabled: protectedProcedure
    .input(
      z.object({
        flag: frontendFeatureFlagSchema,
        projectId: z.string().nullable(),
        organizationId: z.string().nullable(),
      }),
    )
    .noPermission({
      reason:
        "feature flags are read per authenticated user; no tenant data is exposed",
      allow: {
        projectId: "for flag targeting rules, not resource access",
        organizationId: "for flag targeting rules, not resource access",
      },
    })
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

      // `input.flag` is runtime-validated against FRONTEND_FEATURE_FLAGS, but
      // that list is not a subset of the registry: `ops_ui_ops_menu_pinned` is
      // deliberately unregistered, so for that one key the cast below widens a
      // string the type system cannot vouch for. It stays sound at runtime —
      // an unregistered key falls through to the legacy in-memory resolver and
      // returns false — and frontendFlagsRegistered.unit.test.ts pins that
      // exception by name so a second one cannot slip in behind it. For every
      // other entry the cast is exact, and FeatureFlagKey is scope-agnostic,
      // so SYSTEM and PRODUCT keys are equally valid here.
      const enabled = await featureFlagService.isEnabled(
        input.flag as FeatureFlagKey,
        {
          distinctId: userId,
          defaultValue: false,
          projectId: input.projectId ?? NOT_TARGETED,
          organizationId: input.organizationId ?? NOT_TARGETED,
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
    .noPermission({
      reason:
        "feature flags are read per authenticated user; no tenant data is exposed",
    })
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
            // The procedure asks one organization at a time by design, and
            // the surfaces that call it have no project of their own.
            projectId: NOT_TARGETED,
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
    .noPermission({
      reason:
        "feature flags are read per authenticated user; no tenant data is exposed",
    })
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
              // Same as above: an organization-at-a-time read from a
              // workspace surface that has no project.
              projectId: NOT_TARGETED,
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
