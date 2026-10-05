// The seat-quote modal is a shared zustand singleton: opening it here and
// mounting it in the chrome layout is one modal, not a copy.
import { useUpgradeModalStore } from "@langwatch/browser-host/upgrade-modal-store";
import { isGrowthSeatEventPlan } from "@langwatch/enterprise-billing-contract";
import type { MemberType } from "@langwatch/enterprise-licensing-contract";

import { billingApi } from "../../behavior/billing-api.ts";
import { useBillingHost } from "../../model/billing-host.ts";
import {
  type BillingInterval,
  type Currency,
  resolveGrowthSeatPlanType,
} from "../../model/billing-plans.ts";
import { type PlannedUser } from "../../model/subscription-types.ts";

type TRPCRefetchFn = { refetch: () => unknown };

function memberTypeToRole(memberType: MemberType): "MEMBER" | "EXTERNAL" | "DEVELOPER" {
  if (memberType === "FullMember") return "MEMBER";
  if (memberType === "Developer") return "DEVELOPER";
  return "EXTERNAL";
}

/** The planned users that carry an address, as checkout invites. */
function plannedInvites(plannedUsers: PlannedUser[]) {
  return plannedUsers
    .filter((u) => u.email.trim() !== "")
    .map((u) => ({
      email: u.email.trim(),
      role: memberTypeToRole(u.memberType),
    }));
}

/** The seat-event plan a seat change bills on: the active one, else the one for this cut. */
function seatChangePlan({
  activePlanType,
  currency,
  billingPeriod,
}: {
  activePlanType?: string;
  currency: Currency;
  billingPeriod: BillingInterval;
}) {
  return activePlanType && isGrowthSeatEventPlan(activePlanType)
    ? activePlanType
    : resolveGrowthSeatPlanType({ currency, interval: billingPeriod });
}

/**
 * Resolving is not succeeding: the non-seat pricing path answers `{ success: false }` when it
 * has no subscription to change, and "Seats updated successfully" then told customers a seat
 * count had moved when nothing had.
 */
function assertSeatChangeWentThrough(result: { success?: boolean } | undefined): void {
  if (!result?.success) {
    throw new Error("The seat update did not go through");
  }
}

type BillingHost = ReturnType<typeof useBillingHost>;

/** Runs a request that answers with a hosted page, then leaves for it; a failure is toasted. */
async function leaveToAnsweredUrl({
  host,
  request,
  fallbackTitle,
}: {
  host: BillingHost;
  request: () => Promise<{ url?: string | null }>;
  fallbackTitle: string;
}): Promise<void> {
  try {
    const result = await request();
    if (result.url) {
      host.leaveTo(result.url);
    }
  } catch (error) {
    host.failed({ error, fallbackTitle });
  }
}

export function useSubscriptionActions({
  organizationId,
  currency,
  billingPeriod,
  totalFullMembers,
  currentMaxMembers,
  plannedUsers,
  onSeatsUpdated,
  organizationWithMembers,
  activePlanType,
}: {
  organizationId: string | undefined;
  currency: Currency;
  billingPeriod: BillingInterval;
  totalFullMembers: number;
  currentMaxMembers?: number;
  plannedUsers: PlannedUser[];
  onSeatsUpdated: () => void;
  organizationWithMembers: TRPCRefetchFn;
  activePlanType?: string;
}) {
  const host = useBillingHost();
  const openSeats = useUpgradeModalStore((s) => s.openSeats);

  const createSubscription = billingApi.subscription.create.useMutation();
  const upgradeWithInvites = billingApi.subscription.upgradeWithInvites.useMutation();
  const addTeamMemberOrEvents = billingApi.subscription.addTeamMemberOrEvents.useMutation();
  const manageSubscription = billingApi.subscription.manage.useMutation();

  const handleUpgrade = async () => {
    if (!organizationId) return;
    const invites = plannedInvites(plannedUsers);

    await leaveToAnsweredUrl({
      host,
      fallbackTitle: "Couldn't upgrade your plan",
      request: () =>
        invites.length > 0
          ? upgradeWithInvites.mutateAsync({
              organizationId,
              baseUrl: host.applicationOrigin(),
              currency,
              billingInterval: billingPeriod,
              totalSeats: totalFullMembers,
              invites,
            })
          : createSubscription.mutateAsync({
              organizationId,
              baseUrl: host.applicationOrigin(),
              plan: resolveGrowthSeatPlanType({ currency, interval: billingPeriod }),
              membersToAdd: totalFullMembers,
              currency,
              billingInterval: billingPeriod,
            }),
    });
  };

  const handleUpdateSeats = () => {
    if (!organizationId) return;

    const updateTotalMembers = totalFullMembers;

    openSeats({
      organizationId,
      currentSeats: currentMaxMembers ?? totalFullMembers,
      newSeats: updateTotalMembers,
      onConfirm: async (quotedAt) => {
        try {
          const result = await addTeamMemberOrEvents.mutateAsync({
            organizationId,
            plan: seatChangePlan({ activePlanType, currency, billingPeriod }),
            upgradeMembers: true,
            upgradeTraces: false,
            totalMembers: updateTotalMembers,
            totalTraces: 0,
            quotedAt,
          });
          assertSeatChangeWentThrough(result);
          onSeatsUpdated();
          host.succeeded({ title: "Seats updated successfully" });
          void organizationWithMembers.refetch();
        } catch (error) {
          host.failed({ error, fallbackTitle: "Couldn't update your seats" });
        }
      },
    });
  };

  const handleManageSubscription = async () => {
    if (!organizationId) return;

    await leaveToAnsweredUrl({
      host,
      fallbackTitle: "Couldn't open your billing settings",
      request: () =>
        manageSubscription.mutateAsync({ organizationId, baseUrl: host.applicationOrigin() }),
    });
  };

  return {
    handleUpgrade,
    handleUpdateSeats,
    handleManageSubscription,
    isUpgradeLoading: createSubscription.isPending || upgradeWithInvites.isPending,
    isUpdateSeatsLoading: addTeamMemberOrEvents.isPending,
    isManageLoading: manageSubscription.isPending,
  };
}
