import { isGrowthSeatEventPlan } from "@langwatch/enterprise-billing-contract";

import { billingApi } from "../../behavior/billing-api.ts";
import { useBillingHost } from "../../model/billing-host.ts";
import {
  type BillingInterval,
  type Currency,
  resolveGrowthSeatPlanType,
} from "../../model/billing-plans.ts";
import { OrganizationUserRole } from "../../model/prisma-types.ts";

type TRPCRefetchFn = { refetch: () => unknown };

/** Addresses the checkout invites into full seats once it is paid. */
function checkoutInvites(emails: string[]) {
  return emails
    .map((email) => email.trim())
    .filter((email) => email !== "")
    .map((email) => ({ email, role: OrganizationUserRole.MEMBER }));
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

/** A payment that fails on our side is not something a retry fixes. */
const CONTACT_SUPPORT = "Contact support at support@langwatch.ai and we'll sort it out.";

/** Runs a request answering a hosted page, then leaves for it; no page or a failure is toasted. */
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
    if (!result.url) {
      throw new Error("The provider did not answer a page to continue on");
    }
    host.leaveTo(result.url);
  } catch (error) {
    host.failed({ error, fallbackTitle, description: CONTACT_SUPPORT });
  }
}

type SeatChangeMutation = ReturnType<
  typeof billingApi.subscription.addTeamMemberOrEvents.useMutation
>["mutateAsync"];

/** Sends a seat count to billing; a failure is reported to the host and answers false. */
async function applySeatChange({
  mutateAsync,
  host,
  input,
  onApplied,
}: {
  mutateAsync: SeatChangeMutation;
  host: BillingHost;
  input: Parameters<SeatChangeMutation>[0];
  onApplied: () => void;
}): Promise<boolean> {
  try {
    assertSeatChangeWentThrough(await mutateAsync(input));
    onApplied();
    return true;
  } catch (error) {
    host.failed({ error, fallbackTitle: "Couldn't update your seats" });
    return false;
  }
}

export function useSubscriptionActions({
  organizationId,
  currency,
  billingPeriod,
  onSeatsUpdated,
  organizationWithMembers,
  activePlanType,
}: {
  organizationId: string | undefined;
  currency: Currency;
  billingPeriod: BillingInterval;
  onSeatsUpdated: () => void;
  organizationWithMembers: TRPCRefetchFn;
  activePlanType?: string;
}) {
  const host = useBillingHost();

  const createSubscription = billingApi.subscription.create.useMutation();
  const upgradeWithInvites = billingApi.invite.upgradeWithInvites.useMutation();
  const addTeamMemberOrEvents = billingApi.subscription.addTeamMemberOrEvents.useMutation();
  const manageSubscription = billingApi.subscription.manage.useMutation();

  /** Leaves for the Growth checkout for `seats`; the addresses are invited once it is paid. */
  const handleUpgrade = async ({ seats, emails = [] }: { seats: number; emails?: string[] }) => {
    if (!organizationId) return;
    // A member who may not invite still buys the seats; an admin sends the invitations.
    const invites = host.canInviteMembers() ? checkoutInvites(emails) : [];

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
              totalSeats: seats,
              invites,
            })
          : createSubscription.mutateAsync({
              organizationId,
              baseUrl: host.applicationOrigin(),
              plan: resolveGrowthSeatPlanType({ currency, interval: billingPeriod }),
              membersToAdd: seats,
              currency,
              billingInterval: billingPeriod,
            }),
    });
  };

  /** Commits a seat count; a failure is reported and answers false, success says nothing. */
  const commitSeats = async ({
    newSeats,
    quotedAt,
  }: {
    newSeats: number;
    quotedAt: number | undefined;
  }): Promise<boolean> => {
    if (!organizationId) return false;
    return applySeatChange({
      mutateAsync: addTeamMemberOrEvents.mutateAsync,
      host,
      input: {
        organizationId,
        plan: seatChangePlan({ activePlanType, currency, billingPeriod }),
        upgradeMembers: true,
        upgradeTraces: false,
        totalMembers: newSeats,
        totalTraces: 0,
        quotedAt,
      },
      onApplied: () => {
        onSeatsUpdated();
        void organizationWithMembers.refetch();
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
    commitSeats,
    handleManageSubscription,
    isUpgradeLoading: createSubscription.isPending || upgradeWithInvites.isPending,
    isManageLoading: manageSubscription.isPending,
  };
}
