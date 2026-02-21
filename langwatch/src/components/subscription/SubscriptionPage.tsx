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
  getAnnualDiscountPercent,
  formatPrice,
  FREE_PLAN_FEATURES as DEVELOPER_FEATURES,
  GROWTH_FEATURES,
  buildTieredCapabilities,
} from "./billing-plans";
import { useBillingPricing } from "./useBillingPricing";
import { useSubscriptionActions } from "./useSubscriptionActions";
import { classifyMemberType, type MemberType } from "~/server/license-enforcement/member-classification";
import { toaster } from "~/components/ui/toaster";
import {
  OrganizationUserRole,
  TeamUserRole,
} from "@prisma/client";
import {
  isSupportedCurrency,
  formatPlanTypeLabel,
  type PlannedUser,
  type SubscriptionUser,
  type PendingInviteWithMemberType,
  type DrawerSaveResult,
} from "./subscription-types";
import { CurrentPlanBlock } from "./CurrentPlanBlock";
import { UpdateSeatsBlock } from "./UpdateSeatsBlock";
import { UpgradePlanBlock } from "./UpgradePlanBlock";
import { ContactSalesBlock } from "./ContactSalesBlock";
import { UserManagementDrawer } from "./UserManagementDrawer";

const currencyOptions = [
  { label: "\u20AC EUR", value: "EUR" as const },
  { label: "$ USD", value: "USD" as const },
];
const currencyCollection = createListCollection({ items: currencyOptions });

/**
 * Main subscription page component
 */
export function SubscriptionPage() {
  const { organization, team } = useOrganizationTeamProject();
  const organizationCurrency = isSupportedCurrency(organization?.currency)
    ? organization.currency
    : null;
  const hasOrganizationCurrency = organizationCurrency !== null;
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [plannedUsers, setPlannedUsers] = useState<PlannedUser[]>([]);
  const [deletedSeatCount, setDeletedSeatCount] = useState(0);
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annually">(
    "monthly",
  );
  const [showSuccess, setShowSuccess] = useState(false);
  const [showUpgradeCredit, setShowUpgradeCredit] = useState(false);

  // Detect currency from IP geolocation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currencyApi = (api as any).currency as
    | { detectCurrency: { useQuery: (input: Record<string, never>, opts: { enabled: boolean }) => { data?: { currency: Currency } } } }
    | undefined;
  const detectedCurrency = currencyApi?.detectCurrency?.useQuery({}, {
    enabled: !!organization && !hasOrganizationCurrency,
  });

  useEffect(() => {
    if (hasOrganizationCurrency) {
      setCurrency(organizationCurrency);
      return;
    }

    if (detectedCurrency?.data?.currency) {
      setCurrency(detectedCurrency.data.currency);
    }
  }, [
    detectedCurrency?.data?.currency,
    hasOrganizationCurrency,
    organizationCurrency,
  ]);

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
  const isTieredPricingModel = organization?.pricingModel === "TIERED";
  const isEnterprisePlan = plan?.type === "ENTERPRISE";
  const isTieredLegacyPaidPlan = isTieredPricingModel && !isDeveloperPlan && !isEnterprisePlan;

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

  const existingCoreMembers = users.filter((u) => u.memberType === "FullMember").length;
  const plannedCoreSeatCount = allPlannedUsers.filter((u) => u.memberType === "FullMember").length;
  const seatUsageN = existingCoreMembers + plannedCoreSeatCount;
  const seatUsageM = plan?.maxMembers;

  const {
    seatPricePerPeriodCents,
    periodSuffix,
    totalFullMembers,
    pricePerSeat,
    monthlyEquivalent,
  } = useBillingPricing({ currency, billingPeriod, users, plannedUsers: allPlannedUsers });

  // Free plan allows 1 extra seat beyond active members; paid plan uses plan capacity
  const effectiveMaxSeats = isDeveloperPlan ? 1 : seatUsageM;

  // Manual planned seats only (NOT pending invites — they're already in maxMembers)
  const newPlannedFullMembers = plannedUsers.filter(
    (u) => u.memberType === "FullMember"
  ).length;

  // Single source of truth for billing seat count
  const billingSeats = isDeveloperPlan
    ? Math.max(
        totalFullMembers,
        (effectiveMaxSeats ?? 0) + newPlannedFullMembers - deletedSeatCount
      )
    : (effectiveMaxSeats ?? totalFullMembers) + newPlannedFullMembers - deletedSeatCount;

  const billingPriceCents = billingSeats * seatPricePerPeriodCents;
  const billingPriceFormatted = `${formatPrice(billingPriceCents, currency)}${periodSuffix}`;

  const handleDrawerSave = (result: DrawerSaveResult) => {
    // 1. Store new seats for upgrade flow (manually-added only)
    setPlannedUsers(result.newSeats);

    // 2. Store deleted seat count for downgrade flow
    setDeletedSeatCount(result.deletedSeatCount);

    // 3. Paid plan: send invites immediately for already-paid seats
    if (!isDeveloperPlan && result.inviteEmails.length > 0 && organization?.id) {
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

    // 4. Free plan: auto-fill rows with email go to plannedUsers (for upgrade flow)
    if (isDeveloperPlan && result.inviteEmails.length > 0) {
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
    currency,
    billingPeriod,
    totalFullMembers: billingSeats,
    currentMaxMembers: seatUsageM ?? undefined,
    plannedUsers,
    onSeatsUpdated: () => {
      setPlannedUsers([]);
      setDeletedSeatCount(0);
      void activePlan.refetch();
      void pendingInvites.refetch();
    },
    organizationWithMembers,
  });

  if (!organization || !plan) {
    return (
      <SettingsLayout>
        <Flex justifyContent="center" padding={8}>
          <Spinner />
        </Flex>
      </SettingsLayout>
    );
  }

  const currentPlanName = isTieredPricingModel
    ? (plan.name ?? formatPlanTypeLabel(plan.type))
    : isDeveloperPlan
      ? "Free plan"
      : "Growth plan";
  const currentPlanDescription = isTieredPricingModel
    ? undefined
    : isDeveloperPlan
      ? undefined
      : `${formatPrice(seatPricePerPeriodCents * (plan?.maxMembers ?? 1), currency)}${periodSuffix}`;
  const currentPlanFeatures = isTieredLegacyPaidPlan
    ? buildTieredCapabilities({
      maxMembers: plan?.maxMembers ?? 0,
      maxMessagesPerMonth: plan?.maxMessagesPerMonth ?? 0,
      maxProjects: plan?.maxProjects ?? 0,
      maxMembersLite: plan?.maxMembersLite ?? 0,
      evaluationsCredit: plan?.evaluationsCredit ?? 0,
    })
    : isDeveloperPlan
      ? DEVELOPER_FEATURES
      : GROWTH_FEATURES;


  const isUpgradeSeatsRequired =
    !isDeveloperPlan &&
    !isTieredLegacyPaidPlan &&
    (plannedUsers.length > 0 || deletedSeatCount > 0);
  const isUpgradePlanRequired = (
    isDeveloperPlan &&
    (plannedUsers.length > 0 || deletedSeatCount > 0 ))
  || isTieredLegacyPaidPlan;

  const updateRequired = isUpgradeSeatsRequired || isUpgradePlanRequired;

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
            {isDeveloperPlan && (
              <>
                <LabeledSwitch
                  data-testid="billing-period-toggle"
                  left={{ label: "Monthly", value: "monthly" }}
                  right={{ label: "Annually", value: "annually" }}
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
                      setCurrency(selected as Currency);
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
          description={currentPlanDescription}
          features={currentPlanFeatures}
          userCount={seatUsageN}
          maxSeats={seatUsageM}
          upgradeRequired={updateRequired}
          onUserCountClick={() => setIsDrawerOpen(true)}
          onManageSubscription={
            !isDeveloperPlan ? handleManageSubscription : undefined
          }
          isManageLoading={isManageLoading}
          deprecatedNotice={isTieredLegacyPaidPlan}
        />

        {/* Upgrade Block - show for free plan and TIERED legacy paid orgs */}
        {(isUpgradePlanRequired) && (
          <UpgradePlanBlock
            planName={
              <>
                Growth Plan{" "}
                {billingPeriod === "annually" && (
                  <Badge colorPalette="green" variant="subtle" fontSize="xs">
                    Save {getAnnualDiscountPercent(currency)}%
                  </Badge>
                )}
              </>
            }
            pricePerSeat={pricePerSeat}
            totalPrice={billingPriceFormatted}
            coreMembers={billingSeats}
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

        {/* Contact Sales */}
        <ContactSalesBlock />
      </VStack>

      <UserManagementDrawer
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        users={users}
        plannedUsers={plannedUsers}
        pendingInvitesWithMemberType={pendingInvitesWithMemberType}
        seatPricePerPeriodCents={seatPricePerPeriodCents}
        billingPeriod={billingPeriod}
        currency={currency}
        isLoading={organizationWithMembers.isLoading}
        onSave={handleDrawerSave}
        maxSeats={effectiveMaxSeats}
      />
    </SettingsLayout>
  );
}
