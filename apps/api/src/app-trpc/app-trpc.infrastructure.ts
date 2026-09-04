/**
 * The shared infrastructure a feature composes itself from.
 *
 * One typed options object, handed to every `compose<Feature>()` the router
 * literal names, rather than a group half folding ten features' collaborators
 * into one record first. A feature takes the members it needs and ignores the
 * rest; nothing here is a feature's own service, and nothing here is optional
 * for one feature and required for another.
 *
 * It grows as features move onto it and shrinks as the ports record they used
 * to be reached through empties.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ApiAuditPort } from "../api-request.policy";

export type ApiTrpcInfrastructure = Readonly<{
  /** The one guarded connection every row read runs on. */
  prisma: PrismaClient;
  /**
   * The one permission service every surface on this process authorizes
   * through. A second one would give the same organization two permission
   * caches and two epochs.
   */
  authz: AuthzService;
  /**
   * Which plan an organization is on. The SAME provider every allowance banner
   * reads, so a gate and the banner beside it cannot disagree.
   */
  plans: Pick<PlanProvider, "getActivePlan">;
  /**
   * This deployment's flag store. The SAME one `featureFlag.*` answers from, so
   * a rollout gate and the browser's own flag read never disagree about whether
   * an account is inside a rollout.
   */
  featureFlags: FeatureFlagService;
  /**
   * Whether this installation bills through Stripe. One variable, one meaning:
   * `IS_SAAS` is what decides it, read from the one leaf that carries it.
   */
  saasBilling: boolean;
  /** Where a command is recorded, on a process that composed a trail. */
  audit: ApiAuditPort | undefined;
}>;
