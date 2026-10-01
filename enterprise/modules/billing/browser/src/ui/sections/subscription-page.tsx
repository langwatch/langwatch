import { Link } from "@langwatch/browser-host/link";
/**
 * Cloud-only Subscription Page; lets org admins manage plans and users.
 * @see specs/licensing/subscription-page.feature
 */
import { Alert, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { StatusChip } from "@langwatch/design-system/settings-card";
import { CONTACT_SALES_URL, type PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { planSeatsAndVolume } from "@langwatch/plans";
import { useEffect, useState } from "react";

import { billingApi } from "../../behavior/billing-api.ts";
import { useBillingPricingService } from "../../behavior/use-billing-pricing-service.ts";
import { useBillingPricing } from "../../behavior/use-billing-pricing.ts";
import { useBillingHost } from "../../model/billing-host.ts";
import {
  type BillingInterval,
  buildEnterprisePlanFeatures,
  buildPlanCapabilities,
  type Currency,
  FREE_PLAN_FEATURES as DEVELOPER_FEATURES,
  formatPrice,
  getGrowthFeatures,
  isAnnualTieredPlan,
  parseGrowthSeatPlanType,
} from "../../model/billing-plans.ts";
import {
  billingSeatCounts,
  subscriptionChangesRequired,
  subscriptionPlanFlags,
  type SubscriptionPlanFlags,
} from "../../model/subscription-page-state.ts";
import {
  countFullMembers,
  formatPlanTypeLabel,
  type PlannedUser,
} from "../../model/subscription-types.ts";
import { UpdateSeatsBlock } from "../../ui/blocks/update-seats-block.tsx";
import { UpgradePlanBlock } from "../../ui/blocks/upgrade-plan-block.tsx";
import { ContactSalesBlock } from "./contact-sales/index.ts";
import { CurrentPlanBlock } from "./current-plan-block.tsx";
import { InvoicesBlock } from "./invoices-block.tsx";
import { SubscriptionPageHeader } from "./subscription-page-header.tsx";
import { SubscriptionSuccessNotice } from "./subscription-success-notice.tsx";
import { useCheckoutReturn } from "./use-checkout-return.ts";
import { useDrawerSave } from "./use-drawer-save.ts";
import { useSubscriptionActions } from "./use-subscription-actions.ts";
import { useSubscriptionCurrency } from "./use-subscription-currency.ts";
import { useSubscriptionMembers } from "./use-subscription-members.ts";
import { UserManagementDrawer } from "./user-management-drawer.tsx";

function currentPlanNameFor({
  plan,
  isLicenseOverride,
  isTieredPricingModel,
  isDeveloperPlan,
}: {
  plan: PlanInfo;
  isLicenseOverride: boolean;
  isTieredPricingModel: boolean;
  isDeveloperPlan: boolean;
}): string {
  if (isLicenseOverride) return `License: ${plan.name ?? formatPlanTypeLabel(plan.type)}`;
  if (isTieredPricingModel) return plan.name ?? formatPlanTypeLabel(plan.type);
  if (isDeveloperPlan) return "Free plan";
  return "Growth plan";
}

function currentPlanFeaturesFor({
  plan,
  currency,
  isEnterprisePlan,
  isHeldCapabilityPlan,
  isDeveloperPlan,
}: {
  plan: PlanInfo;
  currency: Currency;
  isEnterprisePlan: boolean;
  isHeldCapabilityPlan: boolean;
  isDeveloperPlan: boolean;
}): string[] {
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
  if (isDeveloperPlan) return DEVELOPER_FEATURES;
  return getGrowthFeatures(currency);
}

/** The current plan's price line; a free, tiered or licensed plan shows none. */
function currentPlanPricingFor({
  flags,
  plan,
  seatPricePerPeriodCents,
  currency,
  periodSuffix,
  monthlyEquivalent,
}: {
  flags: SubscriptionPlanFlags;
  plan: PlanInfo;
  seatPricePerPeriodCents: number;
  currency: Currency;
  periodSuffix: string;
  monthlyEquivalent: string;
}) {
  if (flags.isTieredPricingModel || flags.isDeveloperPlan || flags.isLicenseOverride) {
    return undefined;
  }
  const seatCount = plan.maxMembers ?? 1;
  return {
    totalPrice: `${formatPrice({ cents: seatPricePerPeriodCents * seatCount, currency })}${periodSuffix}`,
    seatCount,
    perSeatPrice: monthlyEquivalent,
  };
}

/**
 * Main subscription page component
 */
export function SubscriptionPage() {
  const host = useBillingHost();
  const organization = host.organization();
  const activeTeamId = host.activeTeamId();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [plannedUsers, setPlannedUsers] = useState<PlannedUser[]>([]);
  const [deletedSeatCount, setDeletedSeatCount] = useState(0);
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
  const { organizationWithMembers, pendingInvites, users, pendingInvitesWithMemberType } =
    useSubscriptionMembers(organization?.id);

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

  // Planned seats from the drawer plus pending invites from the database.
  const allPlannedUsers = [...plannedUsers, ...pendingInvitesWithMemberType];
  const existingCoreMembers = countFullMembers(users);
  const seatUsageN = existingCoreMembers + countFullMembers(allPlannedUsers);
  const seatUsageM = plan?.maxMembers;

  const { seatPricePerPeriodCents, periodSuffix, totalFullMembers, monthlyEquivalent } =
    useBillingPricing({
      currency: effectiveCurrency,
      billingPeriod: effectiveBillingPeriod,
      users,
      plannedUsers: allPlannedUsers,
    });

  const { effectiveMaxSeats, billingSeats, upgradeBillingSeats } = billingSeatCounts({
    flags,
    totalFullMembers,
    existingCoreMembers,
    maxMembers: seatUsageM,
    // Manual planned seats only: pending invites are already in maxMembers.
    newPlannedFullMembers: countFullMembers(plannedUsers),
    deletedSeatCount,
  });

  const priceLine = (seats: number) =>
    `${formatPrice({ cents: seats * seatPricePerPeriodCents, currency: effectiveCurrency })}${periodSuffix}`;

  const handleDrawerSave = useDrawerSave({
    invitesIntoPaidSeats: !isDeveloperPlan && !isLicenseOverride,
    organizationId: organization?.id,
    activeTeamId,
    setPlannedUsers,
    setDeletedSeatCount,
    onInvitesSent: () => {
      void pendingInvites.refetch();
      void organizationWithMembers.refetch();
    },
  });

  const {
    handleUpgrade,
    handleUpdateSeats,
    handleManageSubscription,
    isUpgradeLoading,
    isUpdateSeatsLoading,
    isManageLoading,
  } = useSubscriptionActions({
    organizationId: organization?.id,
    currency: effectiveCurrency,
    billingPeriod: effectiveBillingPeriod,
    totalFullMembers: upgradeBillingSeats,
    currentMaxMembers: seatUsageM ?? undefined,
    plannedUsers,
    onSeatsUpdated: () => {
      setPlannedUsers([]);
      setDeletedSeatCount(0);
      void activePlan.refetch();
      void pendingInvites.refetch();
    },
    organizationWithMembers,
    activePlanType: plan?.type,
  });

  if (!organization || activePlan.isLoading || isCurrencyLoading) {
    return <Skeleton width="full" height="200px" />;
  }

  if (activePlan.isError || !plan) {
    return (
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>
            Failed to load subscription information. Please try again later.
          </Alert.Title>
        </Alert.Content>
      </Alert.Root>
    );
  }

  const currentPlanName = currentPlanNameFor({
    plan,
    isLicenseOverride,
    isTieredPricingModel,
    isDeveloperPlan,
  });
  const currentPlanPricing = currentPlanPricingFor({
    flags,
    plan,
    seatPricePerPeriodCents,
    currency: effectiveCurrency,
    periodSuffix,
    monthlyEquivalent,
  });
  // A held plan is described by what it grants; only a plan we sell gets the tier's pitch.
  const currentPlanFeatures = currentPlanFeaturesFor({
    plan,
    currency: effectiveCurrency,
    isEnterprisePlan,
    isHeldCapabilityPlan: isLicenseOverride || isTieredLegacyPaidPlan,
    isDeveloperPlan,
  });

  const { isUpgradeSeatsRequired, isUpgradePlanRequired, updateRequired } =
    subscriptionChangesRequired({
      flags,
      hasSeatChanges: plannedUsers.length > 0 || deletedSeatCount > 0,
    });
  const isSelfManagedPaidPlan = !isDeveloperPlan && !isEnterprisePlan && !isLicenseOverride;

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
          Your plan, your seats and your invoices. Questions about billing?{" "}
          <Link href="mailto:sales@langwatch.ai" color="orange.fg">
            Contact us →
          </Link>
        </Text>

        {showSuccess && <SubscriptionSuccessNotice showUpgradeCredit={showUpgradeCredit} />}

        <CurrentPlanBlock
          planName={currentPlanName}
          pricing={currentPlanPricing}
          features={currentPlanFeatures}
          userCount={seatUsageN}
          maxSeats={isTieredPricingModel ? undefined : seatUsageM}
          upgradeRequired={updateRequired}
          onUserCountClick={() => setIsDrawerOpen(true)}
          onManageSubscription={isSelfManagedPaidPlan ? handleManageSubscription : undefined}
          isManageLoading={isManageLoading}
          deprecatedNotice={isTieredLegacyPaidPlan}
          // Sales has nothing to sell a customer already holding a signed
          // enterprise contract, so they get no upgrade call to action.
          contactSalesUrl={isEnterprisePlan && !isLicenseOverride ? CONTACT_SALES_URL : undefined}
        />

        <InvoicesBlock
          organizationId={organization.id}
          onViewAllInStripe={handleManageSubscription}
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
            onUpgrade={handleUpgrade}
            isLoading={isUpgradeLoading}
          />
        )}

        {isUpgradeSeatsRequired && (
          <UpdateSeatsBlock
            totalFullMembers={billingSeats}
            totalPrice={priceLine(billingSeats)}
            monthlyEquivalent={monthlyEquivalent}
            onUpdate={handleUpdateSeats}
            onDiscard={() => {
              setPlannedUsers([]);
              setDeletedSeatCount(0);
            }}
            isLoading={isUpdateSeatsLoading}
          />
        )}

        {/* Contact Sales - hidden for Enterprise since CTA is in their plan block */}
        {!isEnterprisePlan && <ContactSalesBlock />}
      </VStack>

      <UserManagementDrawer
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        users={users}
        plannedUsers={plannedUsers}
        pendingInvitesWithMemberType={pendingInvitesWithMemberType}
        seatPricePerPeriodCents={seatPricePerPeriodCents}
        billingPeriod={effectiveBillingPeriod}
        currency={effectiveCurrency}
        isLoading={organizationWithMembers.isLoading}
        onSave={handleDrawerSave}
        maxSeats={isTieredPricingModel ? undefined : effectiveMaxSeats}
      />
    </>
  );
}
