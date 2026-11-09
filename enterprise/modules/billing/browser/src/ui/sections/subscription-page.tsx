import { Link } from "@langwatch/browser-host/link";
import type { OrganizationStorageEstimate } from "@langwatch/data-retention-contract";
/**
 * Cloud-only Subscription Page; lets org admins manage plans and users.
 * @see specs/licensing/subscription-page.feature
 */
import { Banner } from "@langwatch/design-system/banner";
import { Skeleton, SkeletonText, Text, VStack } from "@langwatch/design-system/primitives";
import { StatusChip } from "@langwatch/design-system/settings-card";
import { CONTACT_SALES_URL, type PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { planSeatsAndVolume } from "@langwatch/plans";
import { nowInstant } from "@langwatch/time";
import { useEffect, useState } from "react";

import { billingApi, type UsageRead } from "../../behavior/billing-api.ts";
import { useBillingPricingService } from "../../behavior/use-billing-pricing-service.ts";
import { useBillingPricing } from "../../behavior/use-billing-pricing.ts";
import { type BillingHostOrganization, useBillingHost } from "../../model/billing-host.ts";
import {
  type BillingInterval,
  buildEnterprisePlanFeatures,
  buildPlanCapabilities,
  type Currency,
  formatPrice,
  getGrowthFeatures,
  isAnnualTieredPlan,
  parseGrowthSeatPlanType,
} from "../../model/billing-plans.ts";
import { shouldShowPlanLimits } from "../../model/plan-management-url.ts";
import type { RetentionEstimateState } from "../../model/retention-choice.ts";
import { billedSeatsWhileKept } from "../../model/seat-change-summary.ts";
import type { SeatPrice } from "../../model/seat-purchase.ts";
import {
  billingSeatCounts,
  type FixedSeats,
  fixedSeatsOf,
  planEventUsage,
  planPrice,
  type PlanPrice,
  seatUsageCount,
  subscriptionChangesRequired,
  subscriptionPlanFlags,
  type SubscriptionPlanFlags,
} from "../../model/subscription-page-state.ts";
import { countFullMembers, formatPlanTypeLabel } from "../../model/subscription-types.ts";
import { UpgradePlanBlock } from "../../ui/blocks/upgrade-plan-block.tsx";
import { UpgradeSeatsDialog } from "../../ui/blocks/upgrade-seats-dialog.tsx";
import { SeatLimitCallout } from "../../ui/elements/seat-limit-callout.tsx";
import { ContactSalesBlock } from "./contact-sales/index.ts";
import { CurrentPlanBlock } from "./current-plan-block.tsx";
import { InvoicesBlock } from "./invoices-block.tsx";
import { SubscriptionPageHeader } from "./subscription-page-header.tsx";
import { useCheckoutIntent } from "./use-checkout-intent.ts";
import { useSeatPurchase } from "./use-seat-purchase.ts";
import { useSubscriptionActions } from "./use-subscription-actions.ts";
import { useSubscriptionCurrency } from "./use-subscription-currency.ts";
import { useSubscriptionMembers } from "./use-subscription-members.ts";
import {
  type DrawerSeatChange,
  type SeatDrawerMode,
  UserManagementDrawer,
} from "./user-management-drawer.tsx";

function retentionEstimateOf(query: {
  data?: OrganizationStorageEstimate | undefined;
  isError: boolean;
}): RetentionEstimateState {
  if (query.data) return { status: "ready", estimate: query.data };
  return query.isError ? { status: "failed" } : { status: "loading" };
}

function deploymentIsSaaS(host: ReturnType<typeof useBillingHost>): boolean {
  return host.isDeploymentSettled() && host.isSaaS();
}

function currentPlanNameFor({
  plan,
  isLicenseOverride,
  isTieredPricingModel,
  isDeveloperPlan,
  isEnterprisePlan,
  isSaaS,
}: {
  plan: PlanInfo;
  isSaaS: boolean;
  isLicenseOverride: boolean;
  isTieredPricingModel: boolean;
  isDeveloperPlan: boolean;
  isEnterprisePlan: boolean;
}): string {
  if (isLicenseOverride) {
    const name = plan.name ?? formatPlanTypeLabel(plan.type);
    return isSaaS ? name : `License: ${name}`;
  }
  if (isTieredPricingModel) return plan.name ?? formatPlanTypeLabel(plan.type);
  if (isDeveloperPlan) return "Free plan";
  if (isEnterprisePlan) return "Enterprise";
  return "Growth plan";
}

function currentPlanFeaturesFor({
  plan,
  currency,
  isEnterprisePlan,
  isHeldCapabilityPlan,
  isDeveloperPlan,
  retentionDays,
}: {
  plan: PlanInfo;
  currency: Currency;
  isEnterprisePlan: boolean;
  isHeldCapabilityPlan: boolean;
  isDeveloperPlan: boolean;
  /** The traces retention the organization keeps; the card says 90 days until it loads. */
  retentionDays?: number;
}): string[] | undefined {
  if (isEnterprisePlan) return buildEnterprisePlanFeatures(plan);
  if (isHeldCapabilityPlan) {
    return buildPlanCapabilities(
      planSeatsAndVolume({
        members: plan.maxMembers ?? 0,
        membersLite: plan.maxMembersLite ?? 0,
        messagesPerMonth: plan.maxMessagesPerMonth ?? 0,
      }),
    );
  }
  // The Growth offer below the card lists what the upgrade adds; the Free card shows usage instead.
  if (isDeveloperPlan) return undefined;
  return getGrowthFeatures(currency, retentionDays);
}

/**
 * This month's events for the plan card, with the cap only where the plan is held to one.
 * An enterprise subscription shows no usage row.
 */
function currentPlanEventUsage({
  usage,
  flags,
  pricingModel,
  planSource,
}: {
  usage:
    | Pick<UsageRead, "currentMonthMessagesCount" | "messageLimitInfo" | "usageUnit">
    | undefined;
  flags: SubscriptionPlanFlags;
  pricingModel: BillingHostOrganization["pricingModel"];
  planSource: PlanInfo["planSource"];
}) {
  if (flags.isEnterprisePlan) return undefined;
  return planEventUsage({
    currentMonthCount: usage?.currentMonthMessagesCount,
    messageLimitInfo: usage?.messageLimitInfo,
    usageUnit: usage?.usageUnit,
    showLimit: shouldShowPlanLimits({
      isFree: flags.isDeveloperPlan,
      isEnterprise: flags.isEnterprisePlan,
      pricingModel,
      planSource,
    }),
  });
}

/** The current plan's price row; a free, tiered, licensed or enterprise plan shows none. */
function currentPlanPricingFor({
  flags,
  plan,
  seatPricePerPeriodCents,
  currency,
  periodSuffix,
  monthlyEquivalent,
  billingPeriod,
}: {
  flags: SubscriptionPlanFlags;
  plan: PlanInfo;
  seatPricePerPeriodCents: number;
  currency: Currency;
  periodSuffix: string;
  monthlyEquivalent: string;
  billingPeriod: BillingInterval;
}): PlanPrice | undefined {
  const isUnpriced =
    flags.isTieredPricingModel ||
    flags.isDeveloperPlan ||
    flags.isLicenseOverride ||
    flags.isEnterprisePlan;
  if (isUnpriced) return undefined;
  return planPrice({
    seatCount: plan.maxMembers ?? 1,
    seatPrice: formatPrice({ cents: seatPricePerPeriodCents, currency }),
    total: `${formatPrice({ cents: seatPricePerPeriodCents * (plan.maxMembers ?? 1), currency })}${periodSuffix}`,
    monthlyEquivalent: billingPeriod === "annual" ? monthlyEquivalent : undefined,
  });
}

/**
 * How the plan's seats change: a contract or licence shows them fixed with how to add more;
 * a Growth seat plan quotes and commits a changed count from the drawer.
 */
function seatControlsFor({
  flags,
  isSaaS,
  maxMembers,
  billedSeats,
  organizationId,
  openDrawer,
}: {
  flags: SubscriptionPlanFlags;
  isSaaS: boolean;
  maxMembers: number | null | undefined;
  /** What the provider bills while a lowered count keeps more seats usable. */
  billedSeats: number | undefined;
  organizationId: string;
  openDrawer: () => void;
}): {
  fixedSeats: FixedSeats | undefined;
  drawerSeatChange: DrawerSeatChange | undefined;
  onManageSeats: (() => void) | undefined;
} {
  const fixedSeats = fixedSeatsOf({ flags, isSaaS, maxMembers: maxMembers ?? undefined });
  const isGrowthSeatPlan =
    !flags.isDeveloperPlan &&
    !flags.isEnterprisePlan &&
    !flags.isLicenseOverride &&
    !flags.isTieredPricingModel;
  const drawerSeats = billedSeats ?? maxMembers;
  const drawerSeatChange =
    isGrowthSeatPlan && drawerSeats != null
      ? { organizationId, currentSeats: drawerSeats }
      : undefined;
  return { fixedSeats, drawerSeatChange, onManageSeats: fixedSeats ? undefined : openDrawer };
}

/** On a Growth seat plan the drawer changes seats in place; elsewhere it plans an upgrade. */
function seatDrawerModeFor({
  drawerSeatChange,
  includedSeats,
}: {
  drawerSeatChange: DrawerSeatChange | undefined;
  includedSeats: number | null | undefined;
}): SeatDrawerMode {
  if (drawerSeatChange) {
    return {
      kind: "growth",
      organizationId: drawerSeatChange.organizationId,
      paidSeats: drawerSeatChange.currentSeats,
    };
  }
  return { kind: "free", includedSeats: includedSeats ?? 1 };
}

/** The plan, seat usage and members have all answered. */
function pageDataSettled({ waiting, hasPlan }: { waiting: boolean[]; hasPlan: boolean }) {
  return hasPlan && !waiting.some(Boolean);
}

/**
 * Main subscription page component
 */
export function SubscriptionPage() {
  const host = useBillingHost();
  const organization = host.organization();
  const activeTeamId = host.activeTeamId();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<BillingInterval>("monthly");
  const pricing = useBillingPricingService();
  const { showSuccess, showUpgradeCredit } = useCheckoutReturn();
  const {
    currency,
    setSelectedCurrency,
    isLoading: isCurrencyLoading,
  } = useSubscriptionCurrency(organization?.id);

  const activePlan = billingApi.plan.getActivePlan.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );
  const {
    organizationWithMembers,
    pendingInvites,
    users,
    pendingInvitesWithMemberType,
    heldSeats,
  } = useSubscriptionMembers({
    organizationId: organization?.id,
    readsHeldSeats: host.canReadHeldSeats(),
  });
  // Seat limit state as enforcement counts it (custom roles, open invites)
  const usage = billingApi.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );
  const lastSubscription = billingApi.subscription.getLastSubscription.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );

  const plan = activePlan.data;
  const flags = subscriptionPlanFlags({ plan, pricingModel: organization?.pricingModel });
  const { isDeveloperPlan, isLicenseOverride, isTieredPricingModel, isEnterprisePlan } = flags;
  const { isTieredLegacyPaidPlan } = flags;

  const planType = plan?.type;
  useEffect(() => {
    if (isTieredLegacyPaidPlan && planType && isAnnualTieredPlan(planType)) {
      setBillingPeriod("annual");
    }
  }, [isTieredLegacyPaidPlan, planType]);

  const parsedPlan = plan ? parseGrowthSeatPlanType(plan.type) : null;
  const effectiveBillingPeriod = parsedPlan?.billingInterval ?? billingPeriod;
  const effectiveCurrency = parsedPlan?.currency ?? currency;

  const existingCoreMembers = countFullMembers(users);
  // Members and open invites as enforcement counts them (custom roles included) once the
  // server answered; the page's own count until then. Planning in the drawer never counts.
  const seatUsageN = seatUsageCount({
    serverMembersCount: usage.data?.membersCount,
    plannedFullMembers: 0,
    pageCount: existingCoreMembers + countFullMembers(pendingInvitesWithMemberType),
  });
  const seatUsageM = plan?.maxMembers;
  const isOverPlanSeats = usage.data?.seatLimitInfo?.status === "exceeded";

  const { seatPricePerPeriodCents, periodSuffix, totalFullMembers, monthlyEquivalent } =
    useBillingPricing({
      currency: effectiveCurrency,
      billingPeriod: effectiveBillingPeriod,
      users,
      plannedUsers: pendingInvitesWithMemberType,
    });

  const { upgradeBillingSeats } = billingSeatCounts({
    flags,
    totalFullMembers,
    existingCoreMembers,
    maxMembers: seatUsageM,
    newPlannedFullMembers: 0,
    deletedSeatCount: 0,
    seatUsage: seatUsageN,
  });

  const priceLine = (seats: number) =>
    `${formatPrice({ cents: seats * seatPricePerPeriodCents, currency: effectiveCurrency })}${periodSuffix}`;

  const refreshSeats = () => {
    void activePlan.refetch();
    void pendingInvites.refetch();
    void usage.refetch();
    void lastSubscription.refetch();
    void organizationWithMembers.refetch();
  };
  const {
    handleUpgrade,
    commitSeats,
    handleManageSubscription,
    isUpgradeLoading,
    isManageLoading,
  } = useSubscriptionActions({
    organizationId: organization?.id,
    currency: effectiveCurrency,
    billingPeriod: effectiveBillingPeriod,
    onSeatsUpdated: refreshSeats,
    organizationWithMembers,
    activePlanType: plan?.type,
  });
  const seatPurchase = useSeatPurchase({
    organizationId: organization?.id,
    activeTeamId,
    commitSeats,
    onChanged: refreshSeats,
  });
  const openUpgrade = () => setIsUpgradeDialogOpen(true);
  // Read only while the dialog is open: the first read of a cold organization can take seconds.
  const storageEstimate = billingApi.dataRetention.getOrganizationStorageEstimate.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: isUpgradeDialogOpen && !!organization?.id, retry: false, staleTime: 300_000 },
  );
  const retentionEstimate = retentionEstimateOf(storageEstimate);
  const organizationRetention = billingApi.dataRetention.getOrganizationRetention.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization?.id, retry: false },
  );

  const isPlanLoading = !organization || activePlan.isLoading || isCurrencyLoading;
  const { isUpgradePlanRequired, updateRequired } = subscriptionChangesRequired({
    flags,
    hasSeatChanges: false,
    isOverPlanSeats,
  });
  useCheckoutIntent({
    isReady: pageDataSettled({
      waiting: [isPlanLoading, usage.isLoading, organizationWithMembers.isLoading],
      hasPlan: !!plan,
    }),
    isUpgradeAvailable: isUpgradePlanRequired,
    billingPeriod,
    currency,
    setBillingPeriod,
    setCurrency: setSelectedCurrency,
    openUpgrade,
  });
  if (isPlanLoading || activePlan.isError || !plan) {
    return (
      <SubscriptionPagePlaceholder
        isLoading={isPlanLoading}
        billingPeriod={billingPeriod}
        onBillingPeriodChange={setBillingPeriod}
        currency={currency}
        onCurrencyChange={setSelectedCurrency}
      />
    );
  }

  const currentPlanName = currentPlanNameFor({
    plan,
    isLicenseOverride,
    isTieredPricingModel,
    isDeveloperPlan,
    isEnterprisePlan,
    isSaaS: deploymentIsSaaS(host),
  });
  const currentPlanPricing = currentPlanPricingFor({
    flags,
    plan,
    seatPricePerPeriodCents,
    currency: effectiveCurrency,
    periodSuffix,
    monthlyEquivalent,
    billingPeriod: effectiveBillingPeriod,
  });
  // A held plan is described by what it grants; only a plan we sell gets the tier's pitch.
  const currentPlanFeatures = currentPlanFeaturesFor({
    plan,
    currency: effectiveCurrency,
    isEnterprisePlan,
    isHeldCapabilityPlan: isLicenseOverride || isTieredLegacyPaidPlan,
    isDeveloperPlan,
    ...(organizationRetention.data
      ? { retentionDays: organizationRetention.data.retentionDays }
      : {}),
  });

  const isSelfManagedPaidPlan = !isDeveloperPlan && !isEnterprisePlan && !isLicenseOverride;
  const { fixedSeats, drawerSeatChange, onManageSeats } = seatControlsFor({
    flags,
    isSaaS: deploymentIsSaaS(host),
    maxMembers: seatUsageM,
    billedSeats: billedSeatsWhileKept({
      subscription: lastSubscription.data,
      nowMs: nowInstant().epochMilliseconds,
    }),
    organizationId: organization.id,
    openDrawer: () => setIsDrawerOpen(true),
  });
  const seatPrice: SeatPrice = {
    seatCents: seatPricePerPeriodCents,
    currency: effectiveCurrency,
    periodSuffix,
  };
  const drawerMode = seatDrawerModeFor({ drawerSeatChange, includedSeats: seatUsageM });
  const cardCarriesUpgrade = isDeveloperPlan && !isEnterprisePlan;
  const eventUsage = currentPlanEventUsage({
    usage: usage.data,
    flags,
    pricingModel: organization.pricingModel,
    planSource: plan.planSource,
  });

  return (
    <>
      <SubscriptionPageHeader
        showPlanPickers={
          (isDeveloperPlan || isTieredLegacyPaidPlan || isLicenseOverride) && !isEnterprisePlan
        }
        billingPeriod={billingPeriod}
        onBillingPeriodChange={setBillingPeriod}
        currency={currency}
        onCurrencyChange={setSelectedCurrency}
      />
      <VStack gap={6} width="full" align="stretch" paddingTop={4}>
        <Text color="fg.muted">
          Your plan, your usage, your seats and your invoices. Questions about billing?{" "}
          <Link href="mailto:sales@langwatch.ai" color="orange.fg">
            Contact us →
          </Link>
        </Text>

        {showSuccess && <SubscriptionSuccessNotice showUpgradeCredit={showUpgradeCredit} />}

        <SeatLimitCallout
          seatLimitInfo={usage.data?.seatLimitInfo}
          isUpgradePlanRequired={isUpgradePlanRequired}
          isEnterprisePlan={isEnterprisePlan}
          onAddSeats={() => setIsDrawerOpen(true)}
        />

        <CurrentPlanBlock
          planName={currentPlanName}
          pricing={currentPlanPricing}
          features={currentPlanFeatures}
          eventUsage={eventUsage}
          userCount={seatUsageN}
          maxSeats={isTieredPricingModel ? undefined : seatUsageM}
          upgradeRequired={updateRequired}
          isOverPlanSeats={isOverPlanSeats}
          onUserCountClick={onManageSeats}
          onUpgrade={cardCarriesUpgrade ? openUpgrade : undefined}
          isUpgradeLoading={isUpgradeLoading}
          onManageSubscription={isSelfManagedPaidPlan ? handleManageSubscription : undefined}
          isManageLoading={isManageLoading}
          deprecatedNotice={isTieredLegacyPaidPlan}
          // Sales has nothing to sell a customer already holding a signed
          // enterprise contract, so they get no upgrade call to action.
          contactSalesUrl={isEnterprisePlan && !isLicenseOverride ? CONTACT_SALES_URL : undefined}
          fixedSeats={fixedSeats}
          fixedSeatsContactUrl={CONTACT_SALES_URL}
        />

        {isUpgradePlanRequired && (
          <UpgradePlanBlock
            planName={
              <>
                Growth Plan{" "}
                {effectiveBillingPeriod === "annual" && (
                  <StatusChip
                    label={`Save ${pricing.getAnnualDiscountPercent(effectiveCurrency)}%`}
                    tone="good"
                  />
                )}
              </>
            }
            totalPrice={priceLine(upgradeBillingSeats)}
            coreMembers={upgradeBillingSeats}
            features={getGrowthFeatures(effectiveCurrency)}
            monthlyEquivalent={monthlyEquivalent}
            onUpgrade={openUpgrade}
            isLoading={isUpgradeLoading}
            isRequired={updateRequired}
            isSecondaryAction={cardCarriesUpgrade}
          />
        )}

        {/* Contact Sales - hidden for Enterprise since CTA is in their plan block */}
        {!isEnterprisePlan && <ContactSalesBlock />}

        <InvoicesBlock
          organizationId={organization.id}
          onViewAllInStripe={handleManageSubscription}
          hideWhenEmpty={isDeveloperPlan}
        />
      </VStack>

      <UserManagementDrawer
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        users={users}
        pendingInvitesWithMemberType={pendingInvitesWithMemberType}
        isLoading={organizationWithMembers.isLoading}
        mode={drawerMode}
        inUse={seatUsageN}
        held={heldSeats}
        price={seatPrice}
        onInvite={seatPurchase.invite}
        onUpgrade={handleUpgrade}
        onCommit={seatPurchase.commit}
        isUpgradeLoading={isUpgradeLoading}
      />

      <UpgradeSeatsDialog
        open={isUpgradeDialogOpen}
        onClose={() => setIsUpgradeDialogOpen(false)}
        minimumSeats={upgradeBillingSeats}
        price={seatPrice}
        currency={effectiveCurrency}
        retentionEstimate={retentionEstimate}
        onContinue={({ seats, retentionDays }) => void handleUpgrade({ seats, retentionDays })}
        isLoading={isUpgradeLoading}
      />
    </>
  );
}

/** The page while the plan loads, or when it failed to load. */
function SubscriptionPagePlaceholder({
  isLoading,
  billingPeriod,
  onBillingPeriodChange,
  currency,
  onCurrencyChange,
}: {
  isLoading: boolean;
  billingPeriod: BillingInterval;
  onBillingPeriodChange: (period: BillingInterval) => void;
  currency: Currency;
  onCurrencyChange: (currency: Currency) => void;
}) {
  return (
    <>
      <SubscriptionPageHeader
        showPlanPickers={false}
        billingPeriod={billingPeriod}
        onBillingPeriodChange={onBillingPeriodChange}
        currency={currency}
        onCurrencyChange={onCurrencyChange}
      />
      <VStack gap={6} width="full" align="stretch" paddingTop={4}>
        {isLoading ? (
          <>
            <SkeletonText noOfLines={1} width="320px" />
            <Skeleton width="full" height="180px" borderRadius="lg" />
            <Skeleton width="full" height="140px" borderRadius="lg" />
          </>
        ) : (
          <Banner status="error">
            Failed to load subscription information. Please try again later.
          </Banner>
        )}
      </VStack>
    </>
  );
}

/** The banner a checkout returns to, with the proration note after a plan change. */
function SubscriptionSuccessNotice({ showUpgradeCredit }: { showUpgradeCredit: boolean }) {
  return (
    <Banner status="success" data-testid="subscription-success" title="Subscription activated">
      {showUpgradeCredit && (
        <span data-testid="credit-notice">
          Your previous plan has been prorated. Any unused credit has been applied to your account
          and will offset future invoices.
        </span>
      )}
    </Banner>
  );
}

/** Whether the page was returned to from a checkout, and from a plan change with credit. */
function useCheckoutReturn() {
  const query = useBillingHost().routeQuery();
  const [showSuccess, setShowSuccess] = useState(false);
  const [showUpgradeCredit, setShowUpgradeCredit] = useState(false);

  useEffect(() => {
    if (query.success !== void 0) setShowSuccess(true);
    if (query.upgraded_from !== void 0) setShowUpgradeCredit(true);
  }, [query.success, query.upgraded_from]);

  return { showSuccess, showUpgradeCredit };
}
