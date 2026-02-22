import { PlanTypes } from "@prisma/client";
import { toaster } from "~/components/ui/toaster";
import { useUpgradeModalStore } from "../../stores/upgradeModalStore";
import { api } from "~/utils/api";
import type { Currency } from "./billing-plans";
import { type PlannedUser } from "./subscription-types";
import { type MemberType } from "~/server/license-enforcement/member-classification";

type GrowthSeatPlanType = Extract<PlanTypes, `GROWTH_SEAT_${string}`>;

const GROWTH_SEAT_PLAN_MAP: Record<`${Currency}_${"monthly" | "annually"}`, GrowthSeatPlanType> = {
  EUR_monthly: PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
  EUR_annually: PlanTypes.GROWTH_SEAT_EUR_ANNUAL,
  USD_monthly: PlanTypes.GROWTH_SEAT_USD_MONTHLY,
  USD_annually: PlanTypes.GROWTH_SEAT_USD_ANNUAL,
};

function resolveGrowthSeatPlanType(
  currency: Currency,
  billingPeriod: "monthly" | "annually",
): GrowthSeatPlanType {
  return GROWTH_SEAT_PLAN_MAP[`${currency}_${billingPeriod}`];
}

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
  billingPeriod: "monthly" | "annually";
  totalFullMembers: number;
  currentMaxMembers?: number;
  plannedUsers: PlannedUser[];
  onSeatsUpdated: () => void;
  organizationWithMembers: TRPCRefetchFn;
  activePlanType?: string;
}) {
  const openSeats = useUpgradeModalStore((s) => s.openSeats);

  const createSubscription = api.subscription.create.useMutation();
  const upgradeWithInvites = api.subscription.upgradeWithInvites.useMutation();
  const addTeamMemberOrEvents =
    api.subscription.addTeamMemberOrEvents.useMutation();
  const manageSubscription = api.subscription.manage.useMutation();

  const handleUpgrade = async () => {
    if (!organizationId) return;

    // Separate invites (have email) from empty seats
    const invitesWithEmail = plannedUsers
      .filter((u) => u.email.trim() !== "")
      .map((u) => ({
        email: u.email,
        role: memberTypeToRole(u.memberType),
      }));

    if (invitesWithEmail.length > 0) {
      const result = await upgradeWithInvites.mutateAsync({
        organizationId,
        baseUrl: window.location.origin,
        currency,
        billingInterval: billingPeriod === "annually" ? "annual" : "monthly",
        totalSeats: totalFullMembers,
        invites: invitesWithEmail,
      });

      if (result.url) {
        window.location.href = result.url;
      }
      return;
    }

    // Fallback to create mutation (no invites)
    const result = await createSubscription.mutateAsync({
      organizationId,
      baseUrl: window.location.origin,
      plan: resolveGrowthSeatPlanType(currency, billingPeriod),
      membersToAdd: totalFullMembers,
      currency,
      billingInterval: billingPeriod === "annually" ? "annual" : "monthly",
    });

    if (result.url) {
      window.location.href = result.url;
    }
  };

  const handleUpdateSeats = () => {
    if (!organizationId) return;

    const updateTotalMembers = totalFullMembers;

    openSeats({
      organizationId,
      currentSeats: currentMaxMembers ?? totalFullMembers,
      newSeats: updateTotalMembers,
      onConfirm: async () => {
        await addTeamMemberOrEvents.mutateAsync({
          organizationId,
          plan: (activePlanType as GrowthSeatPlanType) ?? resolveGrowthSeatPlanType(currency, billingPeriod),
          upgradeMembers: true,
          upgradeTraces: false,
          totalMembers: updateTotalMembers,
          totalTraces: 0,
        });
        onSeatsUpdated();
        toaster.create({
          title: "Seats updated successfully",
          type: "success",
        });
        void organizationWithMembers.refetch();
      },
    });
  };

  const handleManageSubscription = async () => {
    if (!organizationId) return;

    const result = await manageSubscription.mutateAsync({
      organizationId,
      baseUrl: window.location.origin,
    });

    if (result.url) {
      window.location.href = result.url;
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
