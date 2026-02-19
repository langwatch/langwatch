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
  Card,
  Collapsible,
  createListCollection,
  Flex,
  Heading,
  HStack,
  Input,
  Separator,
  SimpleGrid,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowRight, Check, ChevronDown, Info, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SettingsLayout from "~/components/SettingsLayout";
import { Drawer } from "~/components/ui/drawer";
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
} from "./billing-plans";
import { useBillingPricing } from "./useBillingPricing";
import { useSubscriptionActions } from "./useSubscriptionActions";
import { classifyMemberType, type MemberType } from "~/server/license-enforcement/member-classification";
import { toaster } from "~/components/ui/toaster";
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { z } from "zod";

const emailSchema = z.string().email();
const isValidEmail = (value: string) => emailSchema.safeParse(value).success;

/**
 * User representation in the subscription context
 */
interface SubscriptionUser {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  memberType: MemberType;
  status?: "active" | "pending";
}

/**
 * Local state for a user being edited
 */
interface EditableUser extends SubscriptionUser {
  isNew?: boolean;
}

const currencyOptions = [
  { label: "€ EUR", value: "EUR" as const },
  { label: "$ USD", value: "USD" as const },
];
const currencyCollection = createListCollection({ items: currencyOptions });

function formatPlanTypeLabel(planType?: string | null) {
  if (!planType) {
    return "Current plan";
  }

  return planType
    .toLowerCase()
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Current Plan Block - displays the active subscription
 */
function CurrentPlanBlock({
  planName,
  description,
  features,
  userCount,
  maxSeats,
  upgradeRequired,
  onUserCountClick,
  onManageSubscription,
  isManageLoading,
  deprecatedNotice,
}: {
  planName: string;
  description?: string;
  features?: string[];
  userCount: number;
  maxSeats?: number;
  upgradeRequired?: boolean;
  onUserCountClick?: () => void;
  onManageSubscription?: () => void;
  isManageLoading?: boolean;
  deprecatedNotice?: boolean;
}) {
  return (
    <Card.Root
      data-testid="current-plan-block"
      borderWidth={1}
      borderColor="gray.200"
    >
      <Card.Body paddingY={5} paddingX={6}>
        <VStack align="stretch" gap={5}>
          <Flex justifyContent="space-between" alignItems="flex-start">
            <VStack align="start" gap={1}>
              <HStack gap={3}>
                <Text fontWeight="semibold" fontSize="lg">
                  {planName}
                </Text>
                <Badge
                  colorPalette="blue"
                  variant="outline"
                  borderRadius="md"
                  paddingX={2}
                  paddingY={0.5}
                  fontSize="xs"
                >
                  Current
                </Badge>
                {upgradeRequired && (
                  <Badge
                    colorPalette="orange"
                    variant="subtle"
                    borderRadius="md"
                    paddingX={2}
                    paddingY={0.5}
                    fontSize="xs"
                  >
                    Upgrade required
                  </Badge>
                )}
              </HStack>
              {description && (
                <Text color="gray.500" fontSize="sm">
                  {description}
                </Text>
              )}
            </VStack>
            <VStack align="end" gap={0}>
              <Text color="gray.500" fontSize="sm">
                Users
              </Text>
              <Box
                as="button"
                onClick={onUserCountClick}
                textDecoration="underline"
                _hover={{ color: "blue.600", cursor: "pointer" }}
                color="gray.900"
              >
                <Text
                  fontWeight="semibold"
                  fontSize="lg"
                  data-testid="user-count-link"
                >
                  {maxSeats != null ? `${userCount}/${maxSeats}` : userCount}
                </Text>
              </Box>
            </VStack>
          </Flex>
          {features && (
            <SimpleGrid columns={3} gap={3}>
              {features.map((feature, index) => (
                <HStack key={index} gap={2}>
                  <Check size={16} color="var(--chakra-colors-blue-500)" />
                  <Text fontSize="sm" color="gray.600">
                    {feature}
                  </Text>
                </HStack>
              ))}
            </SimpleGrid>
          )}
          {deprecatedNotice && (
            <Box
              data-testid="tiered-deprecated-notice"
              backgroundColor="orange.50"
              borderWidth={1}
              borderColor="orange.200"
              borderRadius="md"
              padding={4}
            >
              <HStack gap={2} alignItems="start">
                <Info size={16} color="var(--chakra-colors-orange-500)" />
                <Text fontSize="sm" color="orange.900">
                  Your current pricing model has been discontinued.{" "}
                  <Link
                    href="/settings/plans"
                    fontWeight="semibold"
                    color="orange.700"
                    _hover={{ color: "orange.900" }}
                  >
                    Update your plan
                  </Link>{" "}
                  to move to seat and usage billing.
                </Text>
              </HStack>
            </Box>
          )}
          {onManageSubscription && (
            <Button
              data-testid="manage-subscription-button"
              variant="outline"
              size="sm"
              onClick={onManageSubscription}
              loading={isManageLoading}
              disabled={isManageLoading}
            >
              Manage Subscription
            </Button>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * Update seats Block - allows Growth plan users to finalize seat changes
 */
function UpdateSeatsBlock({
  totalFullMembers,
  totalPrice,
  monthlyEquivalent,
  onUpdate,
  onDiscard,
  isLoading,
}: {
  totalFullMembers: number;
  totalPrice: string;
  monthlyEquivalent?: string | null;
  onUpdate: () => void;
  onDiscard: () => void;
  isLoading?: boolean;
}) {
  return (
    <Card.Root
      data-testid="update-seats-block"
      borderWidth={1}
      borderColor="gray.200"
    >
      <Card.Body paddingY={5} paddingX={6}>
        <Flex justifyContent="space-between" alignItems="center">
          <VStack align="start" gap={1}>
            <Text fontWeight="semibold" fontSize="lg">
              Update seats
            </Text>
            <Text fontSize="sm" color="gray.700">
              {totalPrice} for {totalFullMembers} Full Member
              {totalFullMembers !== 1 ? "s" : ""}
            </Text>
            {monthlyEquivalent && (
              <Text fontSize="xs" color="gray.500">
                ({monthlyEquivalent})
              </Text>
            )}
          </VStack>
          <HStack gap={2}>
            <Button
              data-testid="discard-seat-changes-button"
              variant="ghost"
              size="md"
              onClick={onDiscard}
              disabled={isLoading}
            >
              Discard
            </Button>
            <Button
              colorPalette="blue"
              size="md"
              onClick={onUpdate}
              loading={isLoading}
              disabled={isLoading}
            >
              Update subscription
            </Button>
          </HStack>
        </Flex>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * Upgrade Plan Block - displays upgrade CTA with features and dynamic pricing
 */
function UpgradePlanBlock({
  planName,
  pricePerSeat,
  totalPrice,
  coreMembers,
  features,
  monthlyEquivalent,
  onUpgrade,
  isLoading,
}: {
  planName: React.ReactNode;
  pricePerSeat: React.ReactNode;
  totalPrice: string;
  coreMembers: number;
  features: string[];
  monthlyEquivalent?: string | null;
  onUpgrade?: () => void;
  isLoading?: boolean;
}) {
  return (
    <Card.Root
      data-testid="upgrade-plan-block"
      borderWidth={1}
      borderColor="gray.200"
    >
      <Card.Body paddingY={5} paddingX={6}>
        <VStack align="stretch" gap={5}>
          <Flex justifyContent="space-between" alignItems="center">
            <VStack align="start" gap={1}>
              <Text fontWeight="semibold" fontSize="lg">
                Upgrade to {planName}
              </Text>

              <Text
                data-testid="upgrade-total"
                fontSize="sm"
                paddingY={4}
                fontWeight="medium"
                color="gray.700"
              >
                {totalPrice} per {coreMembers} Full Member
                {coreMembers !== 1 ? "s" : ""}
              </Text>
              {monthlyEquivalent && (
                <Text fontSize="xs" color="gray.500">
                  ({monthlyEquivalent})
                </Text>
              )}
            </VStack>
            <Button
              colorPalette="blue"
              size="md"
              onClick={onUpgrade}
              loading={isLoading}
              disabled={isLoading}
            >
              Upgrade now
            </Button>
          </Flex>

          <SimpleGrid columns={3} gap={2}>
            {features.map((feature, index) => (
              <HStack key={index} gap={2}>
                <Check size={16} color="var(--chakra-colors-blue-500)" />
                <Text fontSize="sm" color="gray.600">
                  {feature}
                </Text>
              </HStack>
            ))}
          </SimpleGrid>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * Contact Sales Block - CTA for enterprise or higher-tier needs
 */
function ContactSalesBlock() {
  return (
    <Card.Root
      data-testid="contact-sales-block"
      borderWidth={1}
      borderColor="gray.200"
    >
      <Card.Body paddingY={5} paddingX={6}>
        <Flex justifyContent="space-between" alignItems="center">
          <Text fontWeight="semibold" fontSize="lg">
            Need more?
          </Text>
          <Button asChild variant="outline" size="sm">
            <Link href="mailto:sales@langwatch.ai">
              Contact Sales
            </Link>
          </Button>
        </Flex>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * Planned user for upgrade (ephemeral, not saved to DB)
 */
interface PlannedUser {
  id: string;
  email: string;
  memberType: MemberType;
}

/**
 * Pending invite with classified member type for display in the drawer
 */
interface PendingInviteWithMemberType {
  id: string;
  email: string;
  memberType: MemberType;
}

/**
 * Result of saving the drawer — categorizes rows by action type
 */
interface DrawerSaveResult {
  inviteEmails: string[];       // emails from auto-fill rows (for invite API)
  newSeats: PlannedUser[];      // manually-added rows (for subscription change)
  deletedSeatCount: number;     // auto rows user deleted (for seat reduction)
}

/**
 * User management drawer component
 * Manages ephemeral state for planning upgrades - does NOT save to DB
 */
function UserManagementDrawer({
  open,
  onClose,
  users,
  plannedUsers,
  pendingInvitesWithMemberType,
  seatPricePerPeriodCents,
  billingPeriod,
  currency,
  isLoading,
  onSave,
  maxSeats,
}: {
  open: boolean;
  onClose: () => void;
  users: SubscriptionUser[];
  plannedUsers: PlannedUser[];
  pendingInvitesWithMemberType: PendingInviteWithMemberType[];
  seatPricePerPeriodCents: number;
  billingPeriod: "monthly" | "annually";
  currency: Currency;
  isLoading: boolean;
  onSave: (result: DrawerSaveResult) => void;
  maxSeats?: number;
}) {
  const [editableUsers, setEditableUsers] = useState<EditableUser[]>([]);
  const [localPlannedUsers, setLocalPlannedUsers] = useState<PlannedUser[]>([]);
  const [emailErrors, setEmailErrors] = useState<Record<string, string>>({});
  const [initialAutoFillCount, setInitialAutoFillCount] = useState(0);
  const prevOpenRef = useRef(false);

  // Initialize state only when drawer transitions from closed to open
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (!justOpened) return;

    setEditableUsers(users.map((u) => ({ ...u, isNew: false })));

    const occupiedFullMemberSeats =
      users.filter((u) => u.memberType === "FullMember").length +
      pendingInvitesWithMemberType.filter((inv) => inv.memberType === "FullMember").length +
      plannedUsers.filter((u) => u.memberType === "FullMember").length;

    const autoFillCount = maxSeats != null
      ? Math.max(0, maxSeats - occupiedFullMemberSeats)
      : 0;

    setInitialAutoFillCount(autoFillCount);

    const autoFilledRows: PlannedUser[] = Array.from(
      { length: autoFillCount },
      (_, i) => ({
        id: `auto-${Date.now()}-${i}`,
        email: "",
        memberType: "FullMember" as MemberType,
      })
    );

    setLocalPlannedUsers([...plannedUsers, ...autoFilledRows]);
  }, [open, users, plannedUsers, pendingInvitesWithMemberType, maxSeats]);

  // Reset state when closing without saving
  const handleClose = useCallback(() => {
    setEditableUsers([]);
    setLocalPlannedUsers([]);
    setEmailErrors({});
    onClose();
  }, [onClose]);

  const handleAddSeat = () => {
    const newPlannedUser: PlannedUser = {
      id: `planned-${Date.now()}-${localPlannedUsers.length}`,
      email: "",
      memberType: "FullMember",
    };
    setLocalPlannedUsers((prev) => [...prev, newPlannedUser]);
  };

  const handleRemovePlannedUser = (id: string) => {
    setLocalPlannedUsers((prev) => prev.filter((u) => u.id !== id));
  };

  const handleUpdatePlannedUserEmail = (id: string, email: string) => {
    setLocalPlannedUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, email } : u)),
    );
    setEmailErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleSave = () => {
    const errors: Record<string, string> = {};
    for (const user of localPlannedUsers) {
      const trimmed = user.email.trim();
      if (trimmed !== "" && !isValidEmail(trimmed)) {
        errors[user.id] = "Please enter a valid email address";
      }
    }
    if (Object.keys(errors).length > 0) {
      setEmailErrors(errors);
      return;
    }

    const autoRows = localPlannedUsers.filter((u) => u.id.startsWith("auto-"));
    const manualRows = localPlannedUsers.filter((u) => u.id.startsWith("planned-"));
    const autoRowsWithEmail = autoRows.filter((u) => u.email.trim() !== "");
    const deletedAutoCount = initialAutoFillCount - autoRows.length;

    onSave({
      inviteEmails: autoRowsWithEmail.map((u) => u.email),
      newSeats: manualRows,
      deletedSeatCount: Math.max(0, deletedAutoCount),
    });
    onClose();
  };

  const activeFullMembers = editableUsers.filter(
    (u) => u.memberType === "FullMember",
  ).length;
  const pendingFullMembers = pendingInvitesWithMemberType.filter(
    (inv) => inv.memberType === "FullMember",
  ).length;
  const plannedFullMembers = localPlannedUsers.filter(
    (u) => u.memberType === "FullMember",
  ).length;
  const totalFullMembersInDrawer = activeFullMembers + pendingFullMembers + plannedFullMembers;
  const totalPriceCentsInDrawer = totalFullMembersInDrawer * seatPricePerPeriodCents;
  const periodSuffix = billingPeriod === "annually" ? "/yr" : "/mo";
  const priceLabel = billingPeriod === "annually" ? "Annual Price:" : "Monthly Price:";

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="lg"
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) {
          handleClose();
        }
      }}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Heading size="md">Manage Seats</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>

        <Drawer.Body>
          {isLoading ? (
            <Flex justifyContent="center" padding={8}>
              <Spinner />
            </Flex>
          ) : (
            <VStack align="start" gap={6} width="full">
              {/* Current Members section - collapsible */}
              <Collapsible.Root width="full" >
                <HStack justify="flex-start" width="full">
                  <Collapsible.Trigger asChild>
                    <Button
                      variant="ghost"
                      size="xs"
                      color="gray.500"
                      fontSize="xs"
                    >
                      Show members ({editableUsers.length + pendingInvitesWithMemberType.length})
                      <ChevronDown size={12} />
                    </Button>
                  </Collapsible.Trigger>
                </HStack>
                <Collapsible.Content>
                  <Box as="table" width="full" style={{ borderCollapse: "collapse" }}>
                    <Box as="tbody">
                      {editableUsers.map((user) => (
                        <Box as="tr" key={user.id}>
                          <Box as="td" paddingY={2} verticalAlign="top">
                            <Text fontSize="sm" fontWeight="medium" color="gray.600">
                              {user.email}
                            </Text>
                            <Text fontSize="xs" color="gray.500">
                              Active
                            </Text>
                          </Box>
                          <Box as="td" paddingY={2} textAlign="right" verticalAlign="middle">
                            <Badge
                              colorPalette={user.memberType === "FullMember" ? "blue" : "yellow"}
                              variant="outline"
                            >
                              {user.memberType === "FullMember" ? "Full Member" : "Lite Member"}
                            </Badge>
                          </Box>
                        </Box>
                      ))}
                      {pendingInvitesWithMemberType.map((invite) => (
                        <Box
                          as="tr"
                          key={invite.id}
                          opacity={0.8}
                          data-testid={`pending-invite-${invite.email}`}
                        >
                          <Box as="td" paddingY={2} verticalAlign="top">
                            <Text fontSize="sm" fontWeight="medium" color="gray.600">
                              {invite.email}
                            </Text>
                            <Text fontSize="xs" color="gray.500">
                              Invited - Waiting for acceptance
                            </Text>
                          </Box>
                          <Box as="td" paddingY={2} textAlign="right" verticalAlign="middle">
                            <Badge
                              colorPalette={invite.memberType === "FullMember" ? "blue" : "yellow"}
                              variant="outline"
                            >
                              {invite.memberType === "FullMember" ? "Full Member" : "Lite Member"}
                            </Badge>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Collapsible.Content>
              </Collapsible.Root>

              {/* New Planned Seats section (editable) */}
              <VStack align="start" gap={3} width="full">
                <HStack justify="space-between" width="full">
                  <Text fontWeight="semibold" fontSize="sm" color="gray.500">
                    Seats available
                  </Text>
                  <Button variant="outline" size="sm" onClick={handleAddSeat}>
                    <Plus size={16} />
                    Add Seat
                  </Button>
                </HStack>
                {localPlannedUsers.map((user, index) => (
                  <VStack key={user.id} width="full" gap={1} align="stretch">
                    <HStack
                      data-testid={`pending-seat-${index}`}
                      width="full"
                      gap={2}
                      padding={3}
                      borderWidth={1}
                      borderRadius="md"
                      borderColor={emailErrors[user.id] ? "red.300" : "gray.200"}
                    >
                      <Input
                        data-testid={`seat-email-${index}`}
                        placeholder="Enter email address"
                        size="sm"
                        flex={1}
                        value={user.email}
                        onChange={(e) =>
                          handleUpdatePlannedUserEmail(user.id, e.target.value)
                        }
                      />
                      <Badge
                        data-testid={`seat-member-type-${index}`}
                        colorPalette="blue"
                        variant="outline"
                      >
                        Full Member
                      </Badge>
                      <Button
                        data-testid={`remove-seat-${index}`}
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
                        onClick={() => handleRemovePlannedUser(user.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </HStack>
                    {emailErrors[user.id] && (
                      <Text fontSize="xs" color="red.500" paddingLeft={3}>
                        {emailErrors[user.id]}
                      </Text>
                    )}
                  </VStack>
                ))}
              </VStack>
            </VStack>
          )}
        </Drawer.Body>

        <Drawer.Footer>
          <VStack width="full" gap={4}>
            <VStack
              data-testid="drawer-footer-breakdown"
              align="stretch"
              gap={2}
              fontSize="sm"
              padding={4}
              bg="gray.50"
              borderRadius="md"
              width="full"
            >


              <HStack justify="space-between">
                <Text fontWeight="bold">Total Seats:</Text>
                <Text fontWeight="bold" data-testid="total-seats-footer-count">
                  {totalFullMembersInDrawer}
                </Text>
              </HStack>
              <Separator />

              <HStack justify="space-between">
                <Text fontWeight="bold">{priceLabel}</Text>
                <Text fontWeight="bold" color="blue.600" data-testid="monthly-price-footer">
                  {formatPrice(totalPriceCentsInDrawer, currency)}{periodSuffix}
                </Text>
              </HStack>
            </VStack>

            <HStack width="full" justifyContent="flex-end">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button colorPalette="blue" onClick={handleSave}>
                Done
              </Button>
            </HStack>
          </VStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/**
 * Main subscription page component
 */
export function SubscriptionPage() {
  const { organization, team } = useOrganizationTeamProject();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [plannedUsers, setPlannedUsers] = useState<PlannedUser[]>([]);
  const [deletedSeatCount, setDeletedSeatCount] = useState(0);
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [currencyInitialized, setCurrencyInitialized] = useState(false);
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
    enabled: !currencyInitialized,
  });

  useEffect(() => {
    if (detectedCurrency?.data?.currency && !currencyInitialized) {
      setCurrency(detectedCurrency.data.currency);
      setCurrencyInitialized(true);
    }
  }, [detectedCurrency?.data, currencyInitialized]);

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
    ? undefined
    : isDeveloperPlan
      ? DEVELOPER_FEATURES
      : GROWTH_FEATURES;


  const isUpgradeSeatsRequired = !isDeveloperPlan && (plannedUsers.length > 0 || deletedSeatCount > 0);
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
