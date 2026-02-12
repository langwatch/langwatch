import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import type { Currency } from "./billing-plans";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TRPCRefetchFn = { refetch: () => any };

export function useSubscriptionActions({
  organizationId,
  currency,
  billingPeriod,
  totalCoreMembers,
  onSeatsUpdated,
  organizationWithMembers,
}: {
  organizationId: string | undefined;
  currency: Currency;
  billingPeriod: "monthly" | "annually";
  totalCoreMembers: number;
  onSeatsUpdated: () => void;
  organizationWithMembers: TRPCRefetchFn;
}) {
  // Subscription router is injected via SaaS dependency injection (not in OSS types)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subscriptionApi = (api as any).subscription;
  if (!subscriptionApi?.create) {
    throw new Error(
      "Subscription API not available - SaaS dependency injection may be missing",
    );
  }
  const createSubscription = subscriptionApi.create.useMutation();
  const addTeamMemberOrEvents =
    subscriptionApi.addTeamMemberOrEvents.useMutation();
  const manageSubscription = subscriptionApi.manage.useMutation();

  const handleUpgrade = async () => {
    if (!organizationId) return;

    const result = await createSubscription.mutateAsync({
      organizationId,
      baseUrl: window.location.origin,
      plan: "GROWTH_SEAT_USAGE",
      membersToAdd: totalCoreMembers,
      currency,
      billingInterval: billingPeriod === "annually" ? "annual" : "monthly",
    });

    if (result.url) {
      window.location.href = result.url;
    }
  };

  const handleUpdateSeats = async () => {
    if (!organizationId) return;

    await addTeamMemberOrEvents.mutateAsync({
      organizationId,
      plan: "GROWTH_SEAT_USAGE",
      upgradeMembers: true,
      upgradeTraces: false,
      totalMembers: totalCoreMembers,
      totalTraces: 0,
    });

    onSeatsUpdated();
    toaster.create({
      title: "Seats updated successfully",
      type: "success",
    });
    void organizationWithMembers.refetch();
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
    isUpgradeLoading: createSubscription.isPending,
    isUpdateSeatsLoading: addTeamMemberOrEvents.isPending,
    isManageLoading: manageSubscription.isPending,
  };
}
