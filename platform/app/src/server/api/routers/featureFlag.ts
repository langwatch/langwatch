import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import type { Session } from "~/server/auth";
import { featureFlagService } from "../../featureFlag";
import { FRONTEND_FEATURE_FLAGS } from "../../featureFlag/frontendFeatureFlags";
import type { FeatureFlagKey } from "../../featureFlag/registry";
import {
  isCurrentOrganizationMember,
  isCurrentProjectOrganizationMember,
} from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const logger = createLogger("langwatch:feature-flag-router");

/** What both membership filters need off the request, and nothing more. */
type TargetingContext = { prisma: PrismaClient; session: Session };

/**
 * The targeting identifiers the caller is actually allowed to be evaluated
 * against, which is not the same as the ones they sent.
 *
 * Both ids arrive as client input and both reach the store's targeting rules,
 * so an id the caller does not belong to would let them read that tenant's
 * flag state one boolean at a time. Neither is a resource being read — there
 * is no tenant data in the response — so there is no permission to test, only
 * membership.
 *
 * An id that does not survive is dropped, not rejected. The flag is then
 * evaluated without that targeting dimension and returns the value any caller
 * would get for it, so the response cannot distinguish "not a member" from
 * "flag off" and the procedure cannot be used as a membership oracle.
 *
 * A project is reached through the organization that owns its team. That is
 * the tenancy boundary — the one `resolveProjectPermissionContext` fails
 * closed on before it reads a single binding — and deliberately not the whole
 * of project access, which additionally needs a binding walk
 * (`resolveProjectPermission`). So an org member can be targeted by any
 * project id in their own organization, including one in a team they hold no
 * binding to. That is the intended level: what leaks at worst is which
 * features are on for a project inside a tenant the caller already belongs to,
 * and charging a full permission walk to every flag check on the page would
 * cost more than it buys. The cross-tenant answer is the one that mattered,
 * and that one is closed.
 */
async function allowedTargeting({
  ctx,
  input,
}: {
  ctx: TargetingContext;
  input: { projectId?: string; organizationId?: string };
}): Promise<{ projectId?: string; organizationId?: string }> {
  const userId = ctx.session.user.id;

  const [organizationId, projectId] = await Promise.all([
    input.organizationId === undefined
      ? Promise.resolve(undefined)
      : isCurrentOrganizationMember({
          prisma: ctx.prisma,
          userId,
          organizationId: input.organizationId,
        }).then((member) => (member ? input.organizationId : undefined)),
    input.projectId === undefined
      ? Promise.resolve(undefined)
      : isCurrentProjectOrganizationMember(ctx, input.projectId).then(
          (member) => (member ? input.projectId : undefined),
        ),
  ]);

  return {
    ...(organizationId !== undefined ? { organizationId } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
  };
}

/**
 * The subset of `organizationIds` the user is a current member of, in input
 * order, with the rest silently dropped.
 *
 * OrganizationUser is org-scoped under the single-organization invariant of
 * guardOrganizationId, so a single `in:` query would be rejected for spanning
 * multiple orgs. Resolve per-id; the user's org count is bounded by their
 * workspace list.
 */
async function filterToMemberships({
  ctx,
  userId,
  organizationIds,
}: {
  ctx: { prisma: PrismaClient };
  userId: string;
  organizationIds: string[];
}): Promise<string[]> {
  const memberships = await Promise.all(
    organizationIds.map((organizationId) =>
      isCurrentOrganizationMember({
        prisma: ctx.prisma,
        userId,
        organizationId,
      }),
    ),
  );
  return organizationIds.filter((_, i) => memberships[i]);
}

const frontendFeatureFlagSchema = z.enum([...FRONTEND_FEATURE_FLAGS] as [
  string,
  ...string[],
]);

/**
 * tRPC router for feature flag checks.
 *
 * Resolves through the in-code registry and the operator flag store, with
 * optional project/organization targeting.
 * Results are cached server-side (5s TTL) and client-side (React Query).
 *
 * @see dev/docs/adr/005-feature-flags.md for architecture decisions
 */
export const featureFlagRouter = createTRPCRouter({
  /**
   * Check if a feature flag is enabled for the current user.
   *
   * Both targeting ids are client input, so both are filtered through
   * {@link allowedTargeting} before they reach the store: an id the caller is
   * not a current member of is dropped and the flag is evaluated without it.
   * Without that filter the procedure answers "is flag X on for org Y" for any
   * org id an authenticated user cares to type.
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
    // The membership filter in the resolver is the real authorization check.
    // These ids are targeting input, not resources, so there is no permission
    // for the rbac middleware to test on them.
    .noPermission({
      reason:
        "feature flags are read per authenticated user; no tenant data is exposed",
      allow: {
        projectId: "targeting only, and filtered to the caller's memberships",
        organizationId:
          "targeting only, and filtered to the caller's memberships",
      },
    })
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const targeting = await allowedTargeting({ ctx, input });

      // Both the ids asked for and the ids that survived, because they are
      // different questions. Logging only the survivors makes a caller probing
      // organizations they do not belong to look exactly like a caller who
      // sent no targeting at all, which is the one shape worth being able to
      // see. Dropped-but-legitimate is common enough that this stays at debug
      // rather than warning: a client whose cached organization id has gone
      // stale (seat revoked, organization switched) sends one on every flag
      // check for as long as the cache lives.
      logger.debug(
        {
          userId,
          flag: input.flag,
          requestedProjectId: input.projectId,
          requestedOrganizationId: input.organizationId,
          projectId: targeting.projectId,
          organizationId: targeting.organizationId,
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
          projectId: targeting.projectId,
          organizationId: targeting.organizationId,
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
   * actual current memberships and silently drops the rest — otherwise an
   * authenticated user could probe the flag state of arbitrary organizations
   * they have no business knowing about. Silent drop (rather than throwing on
   * the first unknown id) keeps the response shape indistinguishable between
   * "flag off" and "not a member", so the procedure cannot be used as a
   * membership oracle either.
   *
   * "Current" is doing work there: a seat an admin disabled keeps its
   * `OrganizationUser` row, so the intersection is resolved through
   * {@link isCurrentOrganizationMember} rather than by asking whether the row
   * exists.
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

      const allowedOrganizationIds = await filterToMemberships({
        ctx,
        userId,
        organizationIds: input.organizationIds,
      });

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
    .noPermission({
      reason:
        "feature flags are read per authenticated user; no tenant data is exposed",
    })
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (input.organizationIds.length === 0) {
        return { enabledByOrganizationId: {} as Record<string, boolean> };
      }

      const allowedOrganizationIds = await filterToMemberships({
        ctx,
        userId,
        organizationIds: input.organizationIds,
      });

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
