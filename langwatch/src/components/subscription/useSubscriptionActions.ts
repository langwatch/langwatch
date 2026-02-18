import { toaster } from "~/components/ui/toaster";
import { useUpgradeModalStore } from "../../stores/upgradeModalStore";
import { api } from "~/utils/api";
import type { Currency } from "./billing-plans";
import { type MemberType } from "~/server/license-enforcement/member-classification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TRPCRefetchFn = { refetch: () => any };

interface PlannedUser {
  id: string;
  email: string;
  memberType: MemberType;
}

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

  // Subscription router is injected via SaaS dependency injection (not in OSS types)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subscriptionApi = (api as any).subscription;
  if (!subscriptionApi?.create) {
    throw new Error(
      "Subscription API not available - SaaS dependency injection may be missing",
    );
  }
  const createSubscription = subscriptionApi.create.useMutation();
  const upgradeWithInvites = subscriptionApi.upgradeWithInvites?.useMutation();
  const addTeamMemberOrEvents =
    subscriptionApi.addTeamMemberOrEvents.useMutation();
  const manageSubscription = subscriptionApi.manage.useMutation();

  const handleUpgrade = async () => {
    if (!organizationId) return;

    // Separate invites (have email) from empty seats
    const invitesWithEmail = plannedUsers
      .filter((u) => u.email.trim() !== "")
      .map((u) => ({
        email: u.email,
        role: memberTypeToRole(u.memberType),
      }));

    // If upgradeWithInvites is available and we have invites, use it
    if (upgradeWithInvites && invitesWithEmail.length > 0) {
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

    // Fallback to existing create mutation (no invites or mutation unavailable)
    const result = await createSubscription.mutateAsync({
      organizationId,
      baseUrl: window.location.origin,
      plan: "GROWTH_SEAT_USAGE",
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

    const invitesWithEmail = plannedUsers
      .filter((u) => u.email.trim() !== "")
      .map((u) => ({ email: u.email, role: memberTypeToRole(u.memberType) }));

    // Use plan.maxMembers as base (what's already paid for), add new planned Full Member seats
    const plannedCoreCount = plannedUsers.filter((u) => u.memberType === "FullMember").length;
    const updateTotalMembers = (currentMaxMembers ?? totalFullMembers) + plannedCoreCount;

    openSeats({
      organizationId,
      currentSeats: currentMaxMembers ?? totalFullMembers,
      newSeats: updateTotalMembers,
      onConfirm: async () => {
        await addTeamMemberOrEvents.mutateAsync({
          organizationId,
          plan: "GROWTH_SEAT_USAGE",
          upgradeMembers: true,
          upgradeTraces: false,
          totalMembers: updateTotalMembers,
          totalTraces: 0,
          ...(invitesWithEmail.length > 0 ? { invites: invitesWithEmail } : {}),
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
    isUpgradeLoading: createSubscription.isPending || (upgradeWithInvites?.isPending ?? false),
    isUpdateSeatsLoading: addTeamMemberOrEvents.isPending,
    isManageLoading: manageSubscription.isPending,
  };
}
