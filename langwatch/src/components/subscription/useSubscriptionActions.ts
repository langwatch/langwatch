import { toaster } from "~/components/ui/toaster";
import { useUpgradeModalStore } from "../../stores/upgradeModalStore";
import { api } from "~/utils/api";
import type { Currency } from "./billing-plans";
import { type PlannedUser } from "./subscription-types";
import { type MemberType } from "~/server/license-enforcement/member-classification";

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
}: {
  organizationId: string | undefined;
  currency: Currency;
  billingPeriod: "monthly" | "annually";
  totalFullMembers: number;
  currentMaxMembers?: number;
  plannedUsers: PlannedUser[];
  onSeatsUpdated: () => void;
  organizationWithMembers: TRPCRefetchFn;
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
      plan: "GROWTH_SEAT_EVENT",
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
          plan: "GROWTH_SEAT_EVENT",
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
