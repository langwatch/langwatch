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
  createListCollection,
  Flex,
  Heading,
  HStack,
  Input,
  SimpleGrid,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import SettingsLayout from "~/components/SettingsLayout";
import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Member type for users in the organization
 */
type MemberType = "core" | "lite";

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

const memberTypeOptions = [
  { label: "Full Member", value: "core" as const },
  { label: "Lite Member", value: "lite" as const },
];

const memberTypeCollection = createListCollection({ items: memberTypeOptions });

type Currency = "EUR" | "USD";

const SEAT_PRICE: Record<Currency, number> = { EUR: 29, USD: 32 };
const ANNUAL_DISCOUNT = 0.08;

const currencySymbol: Record<Currency, string> = { EUR: "€", USD: "$" };

const currencyOptions = [
  { label: "€ EUR", value: "EUR" as const },
  { label: "$ USD", value: "USD" as const },
];
const currencyCollection = createListCollection({ items: currencyOptions });

/**
 * Developer plan features for current plan block
 */
const DEVELOPER_FEATURES = [
  "Up to 2 core members",
  "Limited platform features",
  "Community support",
];

/**
 * Growth plan features for upgrade block
 */
const GROWTH_FEATURES = [
  "Up to 20 core users",
  "200,000 events/month (Included)",
  "Unlimited lite users",
  "30 days retention",
  "Unlimited evals",
  "Private Slack support",
];

/**
 * Current Plan Block - displays the active subscription
 */
function CurrentPlanBlock({
  planName,
  description,
  features,
  userCount,
  upgradeRequired,
  onUserCountClick,
}: {
  planName: string;
  description?: string;
  features?: string[];
  userCount: number;
  upgradeRequired?: boolean;
  onUserCountClick?: () => void;
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
                  {userCount}
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
        </VStack>
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
  onUpgrade,
  isLoading,
}: {
  planName: React.ReactNode;
  pricePerSeat: React.ReactNode;
  totalPrice: string;
  coreMembers: number;
  features: string[];
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
                {totalPrice} per {coreMembers} core member
                {coreMembers !== 1 ? "s" : ""}
              </Text>
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
 * Recent Invoices Block - displays invoice history
 */
function RecentInvoicesBlock() {
  return (
    <VStack align="stretch" gap={4} width="full">
      <Text fontWeight="semibold" fontSize="lg">
        Recent invoices
      </Text>
      <Card.Root
        data-testid="invoices-block"
        borderWidth={1}
        borderColor="gray.200"
      >
        <Card.Body paddingY={5} paddingX={6}>
          <Text color="gray.500">No invoices yet</Text>
        </Card.Body>
      </Card.Root>
    </VStack>
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
 * User management drawer component
 * Manages ephemeral state for planning upgrades - does NOT save to DB
 */
function UserManagementDrawer({
  open,
  onClose,
  users,
  plannedUsers,
  isLoading,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  users: SubscriptionUser[];
  plannedUsers: PlannedUser[];
  isLoading: boolean;
  onSave: (plannedUsers: PlannedUser[]) => void;
}) {
  const [editableUsers, setEditableUsers] = useState<EditableUser[]>([]);
  const [localPlannedUsers, setLocalPlannedUsers] = useState<PlannedUser[]>([]);

  // Initialize state when drawer opens
  useEffect(() => {
    if (open) {
      setEditableUsers(users.map((u) => ({ ...u, isNew: false })));
      setLocalPlannedUsers(plannedUsers);
    }
  }, [open, users, plannedUsers]);

  // Reset state when closing without saving
  const handleClose = useCallback(() => {
    setEditableUsers([]);
    setLocalPlannedUsers([]);
    onClose();
  }, [onClose]);

  const handleAddSeat = () => {
    const newPlannedUser: PlannedUser = {
      id: `planned-${Date.now()}-${localPlannedUsers.length}`,
      email: "",
      memberType: "core",
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
  };

  const handleUpdatePlannedUserMemberType = (
    id: string,
    memberType: MemberType,
  ) => {
    setLocalPlannedUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, memberType } : u)),
    );
  };

  const handleSave = () => {
    onSave(localPlannedUsers);
    onClose();
  };

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
              {/* Current Members section */}
              <VStack align="start" gap={3} width="full">
                <Text fontWeight="semibold" fontSize="sm" color="gray.500">
                  Current Members
                </Text>
                {editableUsers.map((user) => (
                  <HStack
                    key={user.id}
                    width="full"
                    justifyContent="space-between"
                    padding={3}
                    borderWidth={1}
                    borderRadius="md"
                    borderColor="gray.200"
                  >
                    <VStack align="start" gap={1}>
                      <Text fontWeight="medium">{user.name || user.email}</Text>
                      <Text fontSize="sm" color="gray.500">
                        {user.email}
                      </Text>
                    </VStack>
                    <Badge
                      colorPalette={
                        user.memberType === "core" ? "blue" : "gray"
                      }
                    >
                      {user.memberType === "core" ? "Core User" : "Lite User"}
                    </Badge>
                  </HStack>
                ))}
              </VStack>

              {/* Pending Seats section */}
              <VStack align="start" gap={3} width="full">
                <Text fontWeight="semibold" fontSize="sm" color="gray.500">
                  Pending Seats
                </Text>
                {localPlannedUsers.map((user, index) => (
                  <HStack
                    key={user.id}
                    data-testid={`pending-seat-${index}`}
                    width="full"
                    gap={2}
                    padding={3}
                    borderWidth={1}
                    borderRadius="md"
                    borderColor="gray.200"
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
                    <Select.Root
                      data-testid={`seat-member-type-${index}`}
                      collection={memberTypeCollection}
                      size="sm"
                      width="160px"
                      value={[user.memberType]}
                      onValueChange={(details) => {
                        const selectedValue = details.value[0];
                        if (selectedValue) {
                          handleUpdatePlannedUserMemberType(
                            user.id,
                            selectedValue as MemberType,
                          );
                        }
                      }}
                    >
                      <Select.Trigger>
                        <Select.ValueText placeholder="Select type" />
                      </Select.Trigger>
                      <Select.Content paddingY={2} zIndex="popover">
                        {memberTypeOptions.map((option) => (
                          <Select.Item key={option.value} item={option}>
                            {option.label}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
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
                ))}
                <Button variant="outline" size="sm" onClick={handleAddSeat}>
                  <Plus size={16} />
                  Add Seat
                </Button>
              </VStack>
            </VStack>
          )}
        </Drawer.Body>

        <Drawer.Footer>
          <HStack width="full" justifyContent="flex-end">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button colorPalette="blue" onClick={handleSave}>
              Done
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/**
 * Main subscription page component
 */
export function SubscriptionPage() {
  const { organization } = useOrganizationTeamProject();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [plannedUsers, setPlannedUsers] = useState<PlannedUser[]>([]);
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annually">(
    "monthly",
  );
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("success")) {
      setShowSuccess(true);
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

  // Map organization members to subscription users format
  const users: SubscriptionUser[] = useMemo(() => {
    if (!organizationWithMembers.data) return [];
    return organizationWithMembers.data.members.map((member) => ({
      id: member.userId,
      userId: member.userId,
      name: member.user.name ?? "",
      email: member.user.email ?? "",
      role: member.role,
      memberType:
        member.role === "EXTERNAL" ? ("lite" as const) : ("core" as const),
    }));
  }, [organizationWithMembers.data]);

  const plan = activePlan.data;
  const isDeveloperPlan = plan?.free ?? true;
  const totalUserCount = users.length + plannedUsers.length;

  // Pricing calculations
  const sym = currencySymbol[currency];
  const basePrice = SEAT_PRICE[currency];
  const annualSeatPrice = Math.round(basePrice * (1 - ANNUAL_DISCOUNT));
  const seatPrice = billingPeriod === "annually" ? annualSeatPrice : basePrice;

  const existingCoreMembers = users.filter(
    (u) => u.memberType === "core",
  ).length;
  const plannedCoreMembers = plannedUsers.filter(
    (u) => u.memberType === "core",
  ).length;
  const totalCoreMembers = existingCoreMembers + plannedCoreMembers;
  const plannedLiteMembers = plannedUsers.filter(
    (u) => u.memberType === "lite",
  ).length;
  const totalPrice = totalCoreMembers * seatPrice;

  const handleSavePlannedUsers = (newPlannedUsers: PlannedUser[]) => {
    setPlannedUsers(newPlannedUsers);
  };

  // Subscription router is injected via SaaS dependency injection (not in OSS types)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subscriptionApi = (api as any).subscription;
  const createSubscription = subscriptionApi.create.useMutation();

  const handleUpgrade = async () => {
    if (!organization) return;

    const result = await createSubscription.mutateAsync({
      organizationId: organization.id,
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

  if (!organization || !plan) {
    return (
      <SettingsLayout>
        <Flex justifyContent="center" padding={8}>
          <Spinner />
        </Flex>
      </SettingsLayout>
    );
  }

  const currentPlanName = isDeveloperPlan ? "Free plan" : "Growth plan";
  const currentPlanDescription = isDeveloperPlan
    ? undefined
    : `${sym}${seatPrice} per user/mo`;
  const currentPlanFeatures = isDeveloperPlan
    ? DEVELOPER_FEATURES
    : GROWTH_FEATURES;

  const pricePerSeat = `${sym}${seatPrice} per seat/mo`;
  const totalPriceFormatted = `${sym}${totalPrice}/mo`;

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
            <HStack gap={3} data-testid="billing-period-toggle">
              <Text
                fontWeight={billingPeriod === "monthly" ? "bold" : "normal"}
              >
                Monthly
              </Text>
              <Switch
                colorPalette="blue"
                checked={billingPeriod === "annually"}
                onCheckedChange={(e) =>
                  setBillingPeriod(e.checked ? "annually" : "monthly")
                }
              />
              <Text
                fontWeight={billingPeriod === "annually" ? "bold" : "normal"}
              >
                Annually
              </Text>
            </HStack>
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
            <HStack gap={2}>
              <Check size={16} color="green" />
              <Text fontWeight="semibold" color="green.800">
                Subscription activated successfully!
              </Text>
            </HStack>
          </Box>
        )}

        {/* Current Plan Block */}
        <CurrentPlanBlock
          planName={currentPlanName}
          description={currentPlanDescription}
          features={currentPlanFeatures}
          userCount={totalUserCount}
          upgradeRequired={plannedUsers.length > 0}
          onUserCountClick={() => setIsDrawerOpen(true)}
        />

        {/* Upgrade Block - only show if on free plan */}
        {isDeveloperPlan && (
          <UpgradePlanBlock
            planName={
              <>
                Growth Plan{" "}
                {billingPeriod === "annually" && (
                  <Badge colorPalette="green" variant="subtle" fontSize="xs">
                    Save {Math.round(ANNUAL_DISCOUNT * 100)}%
                  </Badge>
                )}
              </>
            }
            pricePerSeat={pricePerSeat}
            totalPrice={totalPriceFormatted}
            coreMembers={totalCoreMembers}
            features={GROWTH_FEATURES}
            onUpgrade={handleUpgrade}
            isLoading={createSubscription.isPending}
          />
        )}

        {/* Recent Invoices */}
        <RecentInvoicesBlock />
      </VStack>

      <UserManagementDrawer
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        users={users}
        plannedUsers={plannedUsers}
        isLoading={organizationWithMembers.isLoading}
        onSave={handleSavePlannedUsers}
      />
    </SettingsLayout>
  );
}
