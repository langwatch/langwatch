/**
 * Cloud-only Subscription Page Component
 *
 * Allows organization administrators to view and manage their subscription plan and users.
 * This component is injected via dependencies for LangWatch Cloud deployments.
 *
 * @see specs/licensing/subscription-page.feature
 */
import {
  Badge,
  Box,
  Button,
  createListCollection,
  Flex,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowRight, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import SettingsLayout from "~/components/SettingsLayout";
import { Link } from "~/components/ui/link";
import { Select } from "~/components/ui/select";
import { LabeledSwitch } from "~/components/ui/LabeledSwitch";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  type Currency,
  type BillingInterval,
  getAnnualDiscountPercent,
  formatPrice,
  parseGrowthSeatPlanType,
  isAnnualTieredPlan,
  FREE_PLAN_FEATURES as DEVELOPER_FEATURES,
  GROWTH_FEATURES,
  ENTERPRISE_PLAN_FEATURES,
  buildTieredCapabilities,
} from "./billing-plans";
import { useBillingPricing } from "./useBillingPricing";
import { useSubscriptionActions } from "./useSubscriptionActions";
import { classifyMemberType, type MemberType } from "~/server/license-enforcement/member-classification";
import { toaster } from "~/components/ui/toaster";
import {
  Currency as PrismaCurrency,
  OrganizationUserRole,
  TeamUserRole,
  PricingModel,
} from "@prisma/client";
import {
  formatPlanTypeLabel,
  countFullMembers,
  type PlannedUser,
  type SubscriptionUser,
  type DrawerSaveResult,
} from "./subscription-types";
import { CurrentPlanBlock } from "./CurrentPlanBlock";
import { UpdateSeatsBlock } from "./UpdateSeatsBlock";
import { UpgradePlanBlock } from "./UpgradePlanBlock";
import { ContactSalesBlock } from "./ContactSalesBlock";
import { UserManagementDrawer } from "./UserManagementDrawer";
import { CONTACT_SALES_URL } from "../plans/constants";

const currencyOptions = [
  { label: "\u20AC EUR", value: PrismaCurrency.EUR },
  { label: "$ USD", value: PrismaCurrency.USD },
];
const currencyCollection = createListCollection({ items: currencyOptions });

/**
 * Main subscription page component
 */
export function SubscriptionPage() {
  const { organization, team } = useOrganizationTeamProject();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [plannedUsers, setPlannedUsers] = useState<PlannedUser[]>([]);
  const [deletedSeatCount, setDeletedSeatCount] = useState(0);
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<BillingInterval>(
    "monthly",
  );
  const [showSuccess, setShowSuccess] = useState(false);
  const [showUpgradeCredit, setShowUpgradeCredit] = useState(false);

  const detectedCurrency = api.currency.detectCurrency.useQuery({}, {
    enabled: !!organization,
  });

  const currency = selectedCurrency ?? detectedCurrency.data?.currency ?? PrismaCurrency.EUR;

  useEffect(() => {
    setSelectedCurrency(null);
  }, [organization?.id]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.has("success")) setShowSuccess(true);
      if (params.has("upgraded_from")) setShowUpgradeCredit(true);
    }
  }, []);


  // Fetch active plan
  const activePlan = api.plan.getActivePlan.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );

  // Fetch organization users
  const organizationWithMembers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId: organization?.id ?? "" },
      { enabled: !!organization },
    );

  // Fetch pending invites for seat counting
  const pendingInvites = api.organization.getOrganizationPendingInvites.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );

  // Mutation for sending invites to already-paid seats
  const createInvitesMutation = api.organization.createInvites.useMutation();

  // Map organization members to subscription users format
  const users: SubscriptionUser[] = useMemo(() => {
    if (!organizationWithMembers.data) return [];
    return organizationWithMembers.data.members.map((member) => ({
      id: member.userId,
      userId: member.userId,
      name: member.user.name ?? "",
      email: member.user.email ?? "",
      role: member.role,
      // Note: Using simplified classification (EXTERNAL = LiteMember, others = FullMember)
      // Full classification with customRole permissions would require additional data
      memberType: classifyMemberType(member.role, undefined),
    }));
  }, [organizationWithMembers.data]);

  const plan = activePlan.data;
  const isDeveloperPlan = plan?.free ?? true;
  const isLicenseOverride = plan?.planSource === "license";
  const isTieredPricingModel = organization?.pricingModel === PricingModel.TIERED;
  const isEnterprisePlan = plan?.type === "ENTERPRISE" && !isLicenseOverride;
  const isTieredLegacyPaidPlan = isTieredPricingModel && !isDeveloperPlan && !isEnterprisePlan && !isLicenseOverride;

  useEffect(() => {
    if (isTieredLegacyPaidPlan && plan && isAnnualTieredPlan(plan.type)) {
      setBillingPeriod("annual");
    }
  }, [isTieredLegacyPaidPlan, plan?.type]);

  const parsedPlan = plan ? parseGrowthSeatPlanType(plan.type) : null;
  const effectiveBillingPeriod: BillingInterval = parsedPlan
    ? parsedPlan.billingInterval
    : billingPeriod;
  const effectiveCurrency: Currency = parsedPlan
    ? parsedPlan.currency
    : currency;

  // Classify and map pending invites to include in billing calculation
  const pendingInvitesWithMemberType = useMemo(() => {
    if (!pendingInvites.data) return [];
    return pendingInvites.data
      .filter((inv) => inv.status === "PENDING")
      .map((inv) => ({
        id: inv.id,
        email: inv.email,
        memberType: classifyMemberType(inv.role, undefined),
      }));
  }, [pendingInvites.data]);

  // Combine plannedUsers (from drawer) with pendingInvites (from DB) for billing calculation
  const allPlannedUsers = [...plannedUsers, ...pendingInvitesWithMemberType];

  const existingCoreMembers = countFullMembers(users);
  const plannedCoreSeatCount = countFullMembers(allPlannedUsers);
  const seatUsageN = existingCoreMembers + plannedCoreSeatCount;
  const seatUsageM = plan?.maxMembers;

  const {
    seatPricePerPeriodCents,
    periodSuffix,
    totalFullMembers,
    monthlyEquivalent,
  } = useBillingPricing({ currency: effectiveCurrency, billingPeriod: effectiveBillingPeriod, users, plannedUsers: allPlannedUsers });

  // Free plan allows 1 extra seat beyond active members; license override uses existing member count; paid plan uses plan capacity
  const effectiveMaxSeats = (isDeveloperPlan || isLicenseOverride) ? 1 : seatUsageM;

  // Manual planned seats only (NOT pending invites — they're already in maxMembers)
  const newPlannedFullMembers = countFullMembers(plannedUsers);

  // Single source of truth for billing seat count (never below existing members)
  const billingSeats = (isDeveloperPlan || isLicenseOverride)
    ? Math.max(
        totalFullMembers,
        (effectiveMaxSeats ?? 0) + newPlannedFullMembers - deletedSeatCount
      )
    : Math.max(
        existingCoreMembers,
        (effectiveMaxSeats ?? totalFullMembers) + newPlannedFullMembers - deletedSeatCount,
      );

  // For tiered legacy plans upgrading to seat-based, use actual member count
  // (not the old plan's maxMembers capacity which is irrelevant for the new model)
  const upgradeBillingSeats = isTieredLegacyPaidPlan
    ? Math.max(1, totalFullMembers)
    : billingSeats;

  const billingPriceCents = billingSeats * seatPricePerPeriodCents;
  const billingPriceFormatted = `${formatPrice({ cents: billingPriceCents, currency: effectiveCurrency })}${periodSuffix}`;
  const upgradeBillingPriceCents = upgradeBillingSeats * seatPricePerPeriodCents;
  const upgradeBillingPriceFormatted = `${formatPrice({ cents: upgradeBillingPriceCents, currency: effectiveCurrency })}${periodSuffix}`;

  const handleDrawerSave = (result: DrawerSaveResult) => {
    // 1. Store new seats for upgrade flow (manually-added only)
    setPlannedUsers(result.newSeats);

    // 2. Store deleted seat count for downgrade flow
    setDeletedSeatCount(result.deletedSeatCount);

    // 3. Paid plan: send invites immediately for already-paid seats
    if (!isDeveloperPlan && !isLicenseOverride && result.inviteEmails.length > 0 && organization?.id) {
      createInvitesMutation.mutate({
        organizationId: organization.id,
        invites: result.inviteEmails.map((email) => ({
          email: email.toLowerCase(),
          role: OrganizationUserRole.MEMBER,
          ...(team?.id ? { teams: [{ teamId: team.id, role: TeamUserRole.MEMBER }] } : {}),
        })),
      }, {
        onSuccess: () => {
          toaster.create({ title: "Invites sent successfully", type: "success" });
          void pendingInvites.refetch();
          void organizationWithMembers.refetch();
        },
        onError: (error) => {
          toaster.create({ title: "Failed to send invites", description: error.message, type: "error" });
        },
      });
    }

    // 4. Free plan or license override: auto-fill rows with email go to plannedUsers (for upgrade flow)
    if ((isDeveloperPlan || isLicenseOverride) && result.inviteEmails.length > 0) {
      const inviteAsPlanned: PlannedUser[] = result.inviteEmails.map((email, i) => ({
        id: `invite-${Date.now()}-${i}`,
        email,
        memberType: "FullMember" as MemberType,
      }));
      setPlannedUsers((prev) => [...prev, ...inviteAsPlanned]);
    }
  };

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

  if (!organization || activePlan.isLoading || detectedCurrency.isLoading) {
    return (
      <SettingsLayout>
        <Flex justifyContent="center" padding={8}>
          <Spinner />
        </Flex>
      </SettingsLayout>
    );
  }

  if (activePlan.isError || !plan) {
    return (
      <SettingsLayout>
        <Flex justifyContent="center" padding={8}>
          <Text color="red.500">
            Failed to load subscription information. Please try again later.
          </Text>
        </Flex>
      </SettingsLayout>
    );
  }

  const currentPlanName = isLicenseOverride
    ? `License: ${plan.name ?? "Growth"}`
    : isTieredPricingModel
      ? (plan.name ?? formatPlanTypeLabel(plan.type))
      : isDeveloperPlan
        ? "Free plan"
        : "Growth plan";
  const currentPlanPricing =
    isTieredPricingModel || isDeveloperPlan || isLicenseOverride
      ? undefined
      : {
          totalPrice: `${formatPrice({ cents: seatPricePerPeriodCents * (plan?.maxMembers ?? 1), currency: effectiveCurrency })}${periodSuffix}`,
          seatCount: plan?.maxMembers ?? 1,
          perSeatPrice: monthlyEquivalent,
        };
  const currentPlanFeatures = isLicenseOverride
    ? GROWTH_FEATURES
    : isTieredLegacyPaidPlan
    ? buildTieredCapabilities({
      maxMembers: plan?.maxMembers ?? 0,
      maxMessagesPerMonth: plan?.maxMessagesPerMonth ?? 0,
      maxProjects: plan?.maxProjects ?? 0,
      maxMembersLite: plan?.maxMembersLite ?? 0,
      evaluationsCredit: plan?.evaluationsCredit ?? 0,
    })
    : isEnterprisePlan
      ? ENTERPRISE_PLAN_FEATURES
      : isDeveloperPlan
        ? DEVELOPER_FEATURES
        : GROWTH_FEATURES;


  const isUpgradeSeatsRequired =
    !isDeveloperPlan &&
    !isTieredLegacyPaidPlan &&
    !isEnterprisePlan &&
    !isLicenseOverride &&
    (plannedUsers.length > 0 || deletedSeatCount > 0);
  const isUpgradePlanRequired =
    ((isDeveloperPlan && (plannedUsers.length > 0 || deletedSeatCount > 0))
    || isTieredLegacyPaidPlan || isDeveloperPlan || isLicenseOverride)
    && !isEnterprisePlan;
    const isUpgradePlanRequiredForFreePlan =
    ((isDeveloperPlan && (plannedUsers.length > 0 || deletedSeatCount > 0))
    || (isTieredLegacyPaidPlan))
    && !isEnterprisePlan;

    const freePlanUpgradeRequired = isDeveloperPlan ? isUpgradePlanRequiredForFreePlan : isUpgradePlanRequired;

  const updateRequired = isUpgradeSeatsRequired || freePlanUpgradeRequired;

  return (
    <SettingsLayout>
      <VStack
        gap={6}
        width="full"
        align="stretch"
        maxWidth="900px"
        marginX="auto"
      >
        {/* Header */}
        <Flex justifyContent="space-between" alignItems="flex-start">
          <VStack align="start" gap={1}>
            <Heading size="xl">Billing</Heading>
            <Text color="gray.500">
              For questions about billing,{" "}
              <Link
                href="mailto:sales@langwatch.ai"
                fontWeight="semibold"
                color="gray.700"
                _hover={{ color: "gray.900" }}
              >
                contact us
              </Link>
            </Text>
          </VStack>
          <HStack gap={4} alignItems="center">
            {(isDeveloperPlan || isTieredLegacyPaidPlan || isLicenseOverride) && !isEnterprisePlan && (
              <>
                <LabeledSwitch
                  data-testid="billing-period-toggle"
                  left={{ label: "Monthly", value: "monthly" }}
                  right={{ label: "Annually", value: "annual" }}
                  value={billingPeriod}
                  onChange={setBillingPeriod}
                />
                <Select.Root
                  data-testid="currency-selector"
                  collection={currencyCollection}
                  size="xs"
                  width="100px"
                  value={[currency]}
                  onValueChange={(details) => {
                    const selected = details.value[0];
                    if (selected) {
                      setSelectedCurrency(selected as Currency);
                    }
                  }}
                >
                  <Select.Trigger>
                    <Select.ValueText />
                  </Select.Trigger>
                  <Select.Content paddingY={2} zIndex="popover">
                    {currencyOptions.map((option) => (
                      <Select.Item key={option.value} item={option}>
                        {option.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </>
            )}
            <Link href="/settings/plans">
              <Button variant="ghost" size="sm" color="gray.600">
                All plans <ArrowRight size={14} />
              </Button>
            </Link>
          </HStack>
        </Flex>

        {showSuccess && (
          <Box
            data-testid="subscription-success"
            backgroundColor="green.50"
            borderWidth={1}
            borderColor="green.200"
            borderRadius="md"
            padding={4}
          >
            <VStack align="start" gap={1}>
              <HStack gap={2}>
                <Check size={16} color="green" />
                <Text fontWeight="semibold" color="green.800">
                  Subscription activated successfully!
                </Text>
              </HStack>
              {showUpgradeCredit && (
                <Text fontSize="sm" color="green.700" data-testid="credit-notice">
                  Your previous plan has been prorated. Any unused credit has been
                  applied to your account and will offset future invoices.
                </Text>
              )}
            </VStack>
          </Box>
        )}

        {/* Current Plan Block */}
        <CurrentPlanBlock
          planName={currentPlanName}
          pricing={currentPlanPricing}
          features={currentPlanFeatures}
          userCount={seatUsageN}
          maxSeats={isTieredPricingModel ? undefined : seatUsageM}
          upgradeRequired={updateRequired}
          onUserCountClick={() => setIsDrawerOpen(true)}
          onManageSubscription={
            !isDeveloperPlan && !isEnterprisePlan && !isLicenseOverride ? handleManageSubscription : undefined
          }
          isManageLoading={isManageLoading}
          deprecatedNotice={isTieredLegacyPaidPlan}
          contactSalesUrl={isEnterprisePlan
            ? CONTACT_SALES_URL
            : undefined
          }
        />

        {/* Upgrade Block - show for free plan and TIERED legacy paid orgs */}
        {(isUpgradePlanRequired) && (
          <UpgradePlanBlock
            planName={
              <>
                Growth Plan{" "}
                {effectiveBillingPeriod === "annual" && (
                  <Badge colorPalette="green" variant="subtle" fontSize="xs">
                    Save {getAnnualDiscountPercent(effectiveCurrency)}%
                  </Badge>
                )}
              </>
            }
            totalPrice={upgradeBillingPriceFormatted}
            coreMembers={upgradeBillingSeats}
            features={GROWTH_FEATURES}
            monthlyEquivalent={monthlyEquivalent}
            onUpgrade={handleUpgrade}
            isLoading={isUpgradeLoading}
          />
        )}

        {/* Update seats Block - show for Growth seat+usage plan when seats have been added or removed */}
        {isUpgradeSeatsRequired && (
          <UpdateSeatsBlock
            totalFullMembers={billingSeats}
            totalPrice={billingPriceFormatted}
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
    </SettingsLayout>
  );
}
