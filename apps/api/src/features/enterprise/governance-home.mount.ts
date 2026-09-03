/**
 * `governance.resolveHome`: which `/` destination the authenticated user lands
 * on.
 *
 * Moved out of the retired application's router root, where it was the one
 * hand-written procedure on the `governance.*` namespace beside the five the
 * governance package owns. It stays a PROCESS mount for the same reason it
 * stayed on that root: the decision is not here — it is
 * `PersonaHomeResolverService.resolveSafe`, a pure function the governance
 * contract owns — and what is left is the GATHERING, which spans six owners:
 * the governance setup state, the organization's projects, its plan, the
 * permission engine, the feature flags, the member's own pinned path and the
 * organization's declared intent. No package owns that composition; the
 * composition root does.
 *
 * Every one of those signals except the setup state arrives as a port rather
 * than being read off `ctx`. The platform version read four of them straight
 * off a service locator — `ctx.prisma`, a licence usage service, an imperative
 * permission probe and the flag store — and a mount that reaches for a
 * connection is a mount that cannot be composed twice. The setup state stays on
 * `ctx.app.governance` because that is the slice the other five governance
 * procedures on this same namespace read, and two would be two answers.
 *
 * ## Fail-safe, deliberately
 *
 * Any signal lookup that fails falls through to the project-only home (or `/me`
 * where the member has no projects). This is the LLMOps majority's experience
 * and it is preserved on a transient backend error rather than turned into a
 * failed landing.
 *
 * Critical invariant: an organization with application traces but no governance
 * state lands on `/[project]` — NOT `/governance` — even holding
 * `organization:manage` on an Enterprise plan. The persona-4 gate is
 * conjunctive, and it lives in the resolver rather than here.
 *
 * Specs:
 *   - specs/ai-gateway/governance/persona-home-resolver.feature
 */
import {
  PersonaHomeResolverService,
  type GovernanceService,
  type PersonaResolution,
} from "@langwatch/enterprise-api";
import { appTrpcPolicy, type TrpcApiMount } from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

/** The one slice this procedure reads off the request's application. */
export type GovernanceHomeTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceService }>;
  actor(): Readonly<{ id: string }>;
}>;

/**
 * The six answers the landing decision is gathered from that no package owns.
 *
 * Each is the narrowest question its owner can answer, rather than the service
 * behind it: a project directory, a plan store, a permission engine and a flag
 * store handed over whole would let this one read decide what any of them
 * means.
 */
export type GovernanceHomeTrpcPorts = Readonly<{
  /**
   * The member's own first project in this organization, by team membership.
   *
   * Personal workspaces are excluded outright: they are the governance data
   * home, never a navigable organization project (ADR-038 v6).
   */
  tryFindFirstProjectSlugForMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<string | null>;
  /**
   * The organization's own first project, for a caller who may manage it.
   *
   * Organization managers routinely hold NO team membership row on the default
   * team — `createAndAssign` never adds one — so without this every fresh
   * organization resolves "no project" for its own creator. Its caller scopes
   * it to `organization:manage`, so a low-privilege member is never routed to a
   * project they cannot open.
   */
  tryFindFirstProjectSlug(input: { organizationId: string }): Promise<string | null>;
  /** Whether this organization's active plan is the Enterprise one. */
  isEnterprisePlan(input: { organizationId: string }): Promise<boolean>;
  /** Whether the caller may administer this organization. */
  canManageOrganization(input: { organizationId: string; userId: string }): Promise<boolean>;
  /** Where this member last chose to land, where they pinned one. */
  tryGetPinnedHomePath(input: { userId: string }): Promise<string | null>;
  /**
   * Whether the governance console is switched on for this tenant.
   *
   * `/me` and `/governance` are both gated behind it; without it both 404. The
   * auto-detected destination is gated on it too, so a non-governance
   * organization never lands on `/me`.
   */
  governanceUiEnabled(input: { organizationId: string; userId: string }): Promise<boolean>;
  /**
   * The organization's declared intent, when it set one.
   *
   * It decides the landing kind ahead of persona detection and the member's own
   * pin. Fail-safe: a transient error means "no intent" and takes the legacy
   * path.
   */
  tryGetPrimaryIntent(input: { organizationId: string }): Promise<string | null>;
}>;

const organizationScopeSchema = z.object({ organizationId: z.string() });

/**
 * The `governance.resolveHome` router, for the process to merge into the
 * package's own `governance.*` router.
 *
 * A router of one procedure rather than a procedure, because the namespace has
 * two owners and `mergeRouters` is what puts them on one wire name without
 * either being able to shadow the other's procedures.
 */
export function createGovernanceHomeTrpcRouter<
  TContext extends GovernanceHomeTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> & Readonly<{ ports: GovernanceHomeTrpcPorts }>,
) {
  const policy = appTrpcPolicy(mount.middlewares);
  const { ports } = mount;

  return mount.root.router({
    resolveHome: policy("organization:view")(
      mount.protectedProcedure.input(organizationScopeSchema),
    ).query(async ({ ctx, input }): Promise<PersonaResolution> => {
      const userId = ctx.actor().id;
      const { organizationId } = input;

      const [
        setupState,
        memberProjectSlug,
        isEnterprise,
        hasManage,
        pinnedHomePath,
        hasGovernanceUi,
        organizationIntent,
      ] = await Promise.all([
        ctx.app.governance.resolveSetupState(organizationId),
        ports.tryFindFirstProjectSlugForMember({ organizationId, userId }),
        ports.isEnterprisePlan({ organizationId }).catch(() => false),
        ports.canManageOrganization({ organizationId, userId }),
        ports.tryGetPinnedHomePath({ userId }),
        ports.governanceUiEnabled({ organizationId, userId }).catch(() => false),
        ports.tryGetPrimaryIntent({ organizationId }).catch(() => null),
      ]);

      const firstProjectSlug =
        memberProjectSlug ??
        (hasManage
          ? await ports.tryFindFirstProjectSlug({ organizationId }).catch(() => null)
          : null);

      return PersonaHomeResolverService.create().resolveSafe({
        organizationIntent: organizationIntent as never,
        userLastHomePath: pinnedHomePath,
        setupState: {
          hasPersonalVKs: setupState.hasPersonalVKs,
          hasIngestionSources: setupState.hasIngestionSources,
          hasRecentActivity: setupState.hasRecentActivity,
        },
        hasApplicationTraces: setupState.hasApplicationTraces,
        hasOrganizationManagePermission: hasManage,
        isEnterprise,
        hasGovernanceUi,
        firstProjectSlug,
      });
    }),
  });
}
