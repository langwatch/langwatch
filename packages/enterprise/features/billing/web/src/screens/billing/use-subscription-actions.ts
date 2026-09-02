import type { MemberType } from "@langwatch/enterprise-licensing-contract";
import { billingApi } from "../../behavior/billing-api";
import { useBillingHost } from "../../model/billing-host";
import { isGrowthSeatEventPlan } from "@langwatch/enterprise-billing-contract";
import {
  type BillingInterval,
  type Currency,
  type PlannedUser,
  resolveGrowthSeatPlanType,
} from "../../index";
// THE SEAT-QUOTE MODAL IS ANOTHER PACKAGE'S, and this is the address rather
// than a copy: the store is a zustand singleton exported by
// `@langwatch/workflow-web`, so opening it here and mounting it there is one
// modal. Nothing mounts it above a screen served from `apps/ui` yet — the same
// overlay gap every family since governance has recorded — so on that half the
// seat update opens nothing until the chrome layout route carries it.
import { useUpgradeModalStore } from "@langwatch/workflow-web/stores/upgradeModalStore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TRPCRefetchFn = { refetch: () => any };

function memberTypeToRole(memberType: MemberType): "MEMBER" | "EXTERNAL" {
  return memberType === "FullMember" ? "MEMBER" : "EXTERNAL";
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

    try {
      // Separate invites (have email) from empty seats
      const invitesWithEmail = plannedUsers
        .filter((u) => u.email.trim() !== "")
        .map((u) => ({
          email: u.email.trim(),
          role: memberTypeToRole(u.memberType),
        }));

      if (invitesWithEmail.length > 0) {
        const result = await upgradeWithInvites.mutateAsync({
          organizationId,
          baseUrl: host.applicationOrigin(),
          currency,
          billingInterval: billingPeriod,
          totalSeats: totalFullMembers,
          invites: invitesWithEmail,
        });

        if (result.url) {
          host.leaveTo(result.url);
        }
        return;
      }

      // Fallback to create mutation (no invites)
      const result = await createSubscription.mutateAsync({
        organizationId,
        baseUrl: host.applicationOrigin(),
        plan: resolveGrowthSeatPlanType({ currency, interval: billingPeriod }),
        membersToAdd: totalFullMembers,
        currency,
        billingInterval: billingPeriod,
      });

      if (result.url) {
        host.leaveTo(result.url);
      }
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't upgrade your plan" });
    }
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
          const plan =
            activePlanType && isGrowthSeatEventPlan(activePlanType)
              ? activePlanType
              : resolveGrowthSeatPlanType({
                  currency,
                  interval: billingPeriod,
                });

          const result = await addTeamMemberOrEvents.mutateAsync({
            organizationId,
            plan,
            upgradeMembers: true,
            upgradeTraces: false,
            totalMembers: updateTotalMembers,
            totalTraces: 0,
            quotedAt,
          });

          // Resolving is not the same as succeeding: the non-seat pricing path
          // still answers `{ success: false }` when it has no subscription to
          // change, and reporting that as "Seats updated successfully" told
          // customers a seat count had moved when nothing had.
          if (!result?.success) {
            throw new Error("The seat update did not go through");
          }

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

    try {
      const result = await manageSubscription.mutateAsync({
        organizationId,
        baseUrl: host.applicationOrigin(),
      });

      if (result.url) {
        host.leaveTo(result.url);
      }
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't open your billing settings" });
    }
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
