/**
 * Procedures this package calls: derived namespaces from contract, borrowed ones
 * from features not yet split. Segment names are load-bearing for React Query cache.
 */

import type { subscriptionTrpc, currencyTrpc } from "@langwatch/enterprise-billing-contract";
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { Plan } from "@langwatch/entitlement-contract";
import type { LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import type { OrganizationUserRole, PricingModel, TeamUserRole } from "../model/prisma-types.ts";

/** The organization every billing procedure is scoped to. */
type OrganizationScope = { organizationId: string };

/** The plan an organization is on. Produced by the entitlement provider, not restated. */
export type ActivePlan = Plan;

/**
 * Usage within limits for this period. Counts are read by `mapUsageToLimits`;
 * `usageUnit` decides label (traces or events).
 */
export type UsageRead = {
  activePlan: ActivePlan;
  usageUnit?: string;
  membersCount: number;
  membersLiteCount: number;
  currentMonthMessagesCount: number | null;
};

/** A member row, as the seat count and the seat drawer read it. */
export type OrganizationMemberRead = {
  userId: string;
  role: OrganizationUserRole;
  user: { id: string; name: string | null; email: string | null };
};

/** An invitation that has not been accepted, which still occupies a seat. */
export type PendingInviteRead = {
  id: string;
  email: string;
  role: OrganizationUserRole;
  status: string;
};

/** Procedures from features not yet split: plan, limits, license, organization. */
type BorrowedProcedures = {
  plan: {
    getActivePlan: { query: { input: OrganizationScope; output: ActivePlan } };
  };

  limits: {
    getUsage: { query: { input: OrganizationScope; output: UsageRead } };
  };

  license: {
    getStatus: { query: { input: OrganizationScope; output: LicenseStatus } };
  };

  organization: {
    /**
     * Organization graph with pricingModel to decide seat pricing display.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: Array<{
          id: string;
          name: string;
          pricingModel: PricingModel | null;
          teams: Array<{ id: string; projects: Array<{ id: string }> }>;
        }>;
      };
    };

    getOrganizationWithMembersAndTheirTeams: {
      query: { input: OrganizationScope; output: { members: OrganizationMemberRead[] } };
    };
    getOrganizationPendingInvites: {
      query: { input: OrganizationScope; output: PendingInviteRead[] };
    };
    createInvites: {
      mutation: {
        input: OrganizationScope & {
          invites: Array<{
            email: string;
            role: OrganizationUserRole;
            teams?: Array<{ teamId: string; role: TeamUserRole }>;
          }>;
        };
        output: unknown;
      };
    };
  };
};

/** Everything this family calls: the declared namespaces plus the borrowed four. */
export type BillingApiMap = ContractApiMap<typeof subscriptionTrpc> &
  ContractApiMap<typeof currencyTrpc> &
  BorrowedProcedures;

/**
 * The billing family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy.
 */
export const billingApi = createModuleApi<BillingApiMap>();
