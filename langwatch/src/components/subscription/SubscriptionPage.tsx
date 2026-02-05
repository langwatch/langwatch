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
  Flex,
  Heading,
  HStack,
  Input,
  NativeSelect,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState, useCallback, useMemo, useEffect } from "react";
import { Check, ExternalLink, Users } from "lucide-react";
import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import SettingsLayout from "~/components/SettingsLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PlanInfo } from "../../../ee/licensing/planInfo";
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

/**
 * Plan feature definition for display
 */
interface PlanFeature {
  label: string;
  value: string;
  highlight?: boolean;
}

/**
 * Developer plan features for display
 */
const DEVELOPER_PLAN_FEATURES: PlanFeature[] = [
  { label: "Logs per month", value: "50,000 logs/month" },
  { label: "Data retention", value: "14 days data retention" },
  { label: "Users", value: "2 users", highlight: true },
  { label: "Scenarios", value: "3 scenarios/simulations/custom evals" },
  { label: "Support", value: "Community (GitHub & Discord)" },
];

/**
 * Growth plan features for display
 */
const GROWTH_PLAN_FEATURES: PlanFeature[] = [
  { label: "Events", value: "200,000 events + €1 per 100k extra" },
  { label: "Retention", value: "30 days retention + custom (€3/GB)" },
  { label: "Core users", value: "Up to 20 core users (after volume discount)" },
  { label: "Lite users", value: "Unlimited lite users" },
  { label: "Evals", value: "Unlimited evals/simulations" },
  { label: "Support", value: "Private Slack / Teams" },
];

/**
 * Validates an email address format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Plan Block component for displaying a subscription plan
 */
function PlanBlock({
  planName,
  price,
  features,
  isCurrent,
  buttonText,
  buttonVariant = "solid",
  onButtonClick,
  userCount,
  onUserCountClick,
  testId,
}: {
  planName: string;
  price: string;
  features: PlanFeature[];
  isCurrent: boolean;
  buttonText: string;
  buttonVariant?: "solid" | "outline";
  onButtonClick?: () => void;
  userCount?: number;
  onUserCountClick?: () => void;
  testId: string;
}) {
  return (
    <Card.Root
      data-testid={testId}
      flex={1}
      minWidth="300px"
      borderWidth={isCurrent ? 2 : 1}
      borderColor={isCurrent ? "orange.500" : "gray.200"}
    >
      <Card.Header>
        <HStack justifyContent="space-between">
          <VStack align="start" gap={1}>
            <Heading size="lg">{planName}</Heading>
            <Text fontSize="xl" fontWeight="bold" color="orange.500">
              {price}
            </Text>
          </VStack>
          {isCurrent && (
            <Badge colorPalette="orange" size="lg">
              Current
            </Badge>
          )}
        </HStack>
      </Card.Header>
      <Card.Body>
        <VStack align="start" gap={3}>
          {features.map((feature, index) => (
            <HStack key={index} gap={2}>
              <Check size={16} color="green" />
              {feature.highlight && userCount !== undefined ? (
                <Box
                  as="button"
                  data-testid="user-count-link"
                  onClick={onUserCountClick}
                  _hover={{ textDecoration: "underline", cursor: "pointer" }}
                  color="blue.500"
                >
                  <Text>{userCount} users</Text>
                </Box>
              ) : (
                <Text>{feature.value}</Text>
              )}
            </HStack>
          ))}
        </VStack>
      </Card.Body>
      <Card.Footer>
        <Button
          width="full"
          colorPalette="orange"
          variant={buttonVariant}
          onClick={onButtonClick}
        >
          {buttonText}
        </Button>
      </Card.Footer>
    </Card.Root>
  );
}

/**
 * User row in the management drawer
 */
function UserRow({
  user,
  isAdmin,
  onMemberTypeChange,
}: {
  user: EditableUser;
  isAdmin: boolean;
  onMemberTypeChange: (userId: string, memberType: MemberType) => void;
}) {
  const isDisabled = isAdmin || user.role === "ADMIN";

  return (
    <HStack
      data-testid={`user-row-${user.id}`}
      width="full"
      justifyContent="space-between"
      padding={3}
      borderWidth={1}
      borderRadius="md"
      borderColor="gray.200"
    >
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <Text fontWeight="medium">{user.name || user.email}</Text>
          {user.status === "pending" && (
            <Badge colorPalette="yellow" size="sm">
              pending
            </Badge>
          )}
        </HStack>
        <Text fontSize="sm" color="gray.500">
          {user.email}
        </Text>
      </VStack>
      <HStack gap={2}>
        <NativeSelect.Root
          size="sm"
          width="140px"
          disabled={isDisabled}
        >
          <NativeSelect.Field
            data-testid="member-type-selector"
            value={user.memberType}
            onChange={(e) => {
              if (!isDisabled) {
                onMemberTypeChange(user.id, e.target.value as MemberType);
              }
            }}
          >
            <option value="core">Core User</option>
            <option value="lite">Lite User</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </HStack>
    </HStack>
  );
}

/**
 * Add user form component
 */
function AddUserForm({
  onAdd,
  onCancel,
}: {
  onAdd: (email: string, memberType: MemberType) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [memberType, setMemberType] = useState<MemberType>("lite");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const handleSubmit = () => {
    if (!isValidEmail(email)) {
      setError("Invalid email address");
      return;
    }
    onAdd(email, memberType);
    setEmail("");
    setMemberType("lite");
    setError(null);
    setTouched(false);
  };

  const handleBlur = () => {
    setTouched(true);
    if (email && !isValidEmail(email)) {
      setError("Invalid email address");
    } else {
      setError(null);
    }
  };

  const isAddDisabled = !email || (touched && !isValidEmail(email));

  return (
    <VStack align="start" width="full" gap={3} padding={3} borderWidth={1} borderRadius="md">
      <HStack width="full" gap={3}>
        <Input
          placeholder="Enter email address"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          onBlur={handleBlur}
          flex={1}
        />
        <NativeSelect.Root size="md" width="140px">
          <NativeSelect.Field
            data-testid="new-user-member-type"
            value={memberType}
            onChange={(e) => setMemberType(e.target.value as MemberType)}
          >
            <option value="core">Core User</option>
            <option value="lite">Lite User</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </HStack>
      {error && (
        <Text color="red.500" fontSize="sm">
          {error}
        </Text>
      )}
      <HStack gap={2}>
        <Button size="sm" onClick={handleSubmit} disabled={isAddDisabled}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </HStack>
    </VStack>
  );
}

/**
 * User management drawer component
 */
function UserManagementDrawer({
  open,
  onClose,
  users,
  isLoading,
  onSave,
  isSaving,
  maxMembers,
  currentPlanType,
}: {
  open: boolean;
  onClose: () => void;
  users: SubscriptionUser[];
  isLoading: boolean;
  onSave: (users: EditableUser[]) => Promise<{ hasPendingUsers: boolean }>;
  isSaving: boolean;
  maxMembers: number;
  currentPlanType: string;
}) {
  const [editableUsers, setEditableUsers] = useState<EditableUser[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize editable users when drawer opens or users change
  useEffect(() => {
    if (open && users.length > 0) {
      setEditableUsers(users.map((u) => ({ ...u, isNew: false })));
      setShowAddForm(false);
      setError(null);
    }
  }, [open, users]);

  // Reset state when closing
  const handleClose = useCallback(() => {
    setEditableUsers([]);
    setShowAddForm(false);
    setError(null);
    onClose();
  }, [onClose]);

  // Detect unsaved changes
  const hasChanges = useMemo(() => {
    if (editableUsers.length !== users.length) return true;
    return editableUsers.some((eu) => {
      const original = users.find((u) => u.id === eu.id);
      if (!original) return true;
      return eu.memberType !== original.memberType;
    });
  }, [editableUsers, users]);

  // Check if adding more users requires upgrade
  const exceedsLimit = useMemo(() => {
    const coreUserCount = editableUsers.filter((u) => u.memberType === "core").length;
    return coreUserCount > maxMembers;
  }, [editableUsers, maxMembers]);

  const handleMemberTypeChange = (userId: string, memberType: MemberType) => {
    setEditableUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, memberType } : u))
    );
  };

  const handleAddUser = (email: string, memberType: MemberType) => {
    const newUser: EditableUser = {
      id: `new-${Date.now()}`,
      userId: `new-${Date.now()}`,
      name: "",
      email,
      role: "MEMBER",
      memberType,
      status: "pending",
      isNew: true,
    };
    setEditableUsers((prev) => [...prev, newUser]);
    setShowAddForm(false);
  };

  const handleSave = async () => {
    try {
      setError(null);
      await onSave(editableUsers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  // Check if there's only one admin (can't change to lite)
  const hasOnlyOneAdmin = useMemo(() => {
    return editableUsers.filter((u) => u.role === "ADMIN").length === 1;
  }, [editableUsers]);

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
          <Heading size="md">Manage Users</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>

        <Drawer.Body>
          {isLoading ? (
            <Flex justifyContent="center" padding={8}>
              <Spinner />
            </Flex>
          ) : (
            <VStack align="start" gap={4} width="full">
              {hasOnlyOneAdmin && (
                <Box
                  padding={3}
                  borderRadius="md"
                  backgroundColor="blue.50"
                  borderWidth={1}
                  borderColor="blue.200"
                  width="full"
                >
                  <Text fontSize="sm" color="blue.700">
                    Admin users requires core user status and cannot be changed to lite.
                  </Text>
                </Box>
              )}

              {exceedsLimit && (
                <Box
                  padding={3}
                  borderRadius="md"
                  backgroundColor="orange.50"
                  borderWidth={1}
                  borderColor="orange.200"
                  width="full"
                >
                  <Text fontSize="sm" color="orange.700">
                    You have exceeded the {maxMembers} user limit for the Developer plan.
                    Upgrade to Growth plan to add more users.
                  </Text>
                </Box>
              )}

              {error && (
                <Box
                  padding={3}
                  borderRadius="md"
                  backgroundColor="red.50"
                  borderWidth={1}
                  borderColor="red.200"
                  width="full"
                >
                  <Text fontSize="sm" color="red.700">
                    Error: {error}
                  </Text>
                </Box>
              )}

              {editableUsers.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isAdmin={user.role === "ADMIN"}
                  onMemberTypeChange={handleMemberTypeChange}
                />
              ))}

              {showAddForm ? (
                <AddUserForm
                  onAdd={handleAddUser}
                  onCancel={() => setShowAddForm(false)}
                />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddForm(true)}
                >
                  <Users size={16} />
                  Add User
                </Button>
              )}
            </VStack>
          )}
        </Drawer.Body>

        <Drawer.Footer>
          <HStack width="full" justifyContent="space-between">
            <HStack>
              {hasChanges && (
                <Badge
                  data-testid="unsaved-changes-indicator"
                  colorPalette="yellow"
                >
                  Unsaved changes
                </Badge>
              )}
            </HStack>
            <HStack>
              <Button variant="ghost" onClick={handleClose} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                colorPalette="orange"
                onClick={handleSave}
                disabled={!hasChanges}
                loading={isSaving}
                data-loading={isSaving}
              >
                Save
              </Button>
            </HStack>
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
  const [showPendingBanner, setShowPendingBanner] = useState(false);

  // Fetch active plan
  const activePlan = api.plan.getActivePlan.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization }
  );

  // Fetch organization users - using organization members API
  // In the Cloud version, this would be replaced with a dedicated subscription API
  const organizationWithMembers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId: organization?.id ?? "" },
      { enabled: !!organization }
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
      // For now, treat ADMIN/MEMBER as core, EXTERNAL as lite
      memberType: member.role === "EXTERNAL" ? "lite" as const : "core" as const,
    }));
  }, [organizationWithMembers.data]);

  // Track local edits and saving state
  const [isSaving, setIsSaving] = useState(false);

  const plan = activePlan.data;

  // Determine if current plan is Developer (free) or Growth
  const isDeveloperPlan = plan?.free ?? true;
  const isGrowthPlan = !isDeveloperPlan && plan?.type === "GROWTH";

  const handleSaveUsers = async (editableUsers: EditableUser[]): Promise<{ hasPendingUsers: boolean }> => {
    setIsSaving(true);
    try {
      // For now, this is a placeholder for the actual API call
      // In the Cloud version, this would call a subscription API endpoint
      // For demonstration, we simulate success with pending users
      const hasPendingUsers = editableUsers.some((u) => u.isNew);

      if (hasPendingUsers) {
        setShowPendingBanner(true);
      }

      setIsDrawerOpen(false);
      await organizationWithMembers.refetch();

      return { hasPendingUsers };
    } finally {
      setIsSaving(false);
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

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <Heading>Subscription</Heading>

        {showPendingBanner && (
          <Box
            data-testid="pending-users-banner"
            padding={4}
            borderRadius="md"
            backgroundColor="orange.50"
            borderWidth={1}
            borderColor="orange.300"
            width="full"
          >
            <Text fontWeight="medium" color="orange.800">
              Complete upgrade to activate pending users
            </Text>
          </Box>
        )}

        <Flex gap={6} width="full" wrap="wrap">
          <PlanBlock
            testId="plan-block-developer"
            planName="Developer"
            price="Free"
            features={DEVELOPER_PLAN_FEATURES}
            isCurrent={isDeveloperPlan}
            buttonText="Get Started"
            buttonVariant={isDeveloperPlan ? "outline" : "solid"}
            userCount={users.length || plan.maxMembers}
            onUserCountClick={() => setIsDrawerOpen(true)}
          />

          <PlanBlock
            testId="plan-block-growth"
            planName="Growth"
            price="€29/seat/month"
            features={GROWTH_PLAN_FEATURES}
            isCurrent={isGrowthPlan}
            buttonText="Try for Free"
            buttonVariant={isGrowthPlan ? "outline" : "solid"}
          />
        </Flex>

        <Link
          href="mailto:sales@langwatch.ai"
          color="blue.500"
          display="flex"
          alignItems="center"
          gap={2}
        >
          <ExternalLink size={16} />
          Need more? Contact sales
        </Link>
      </VStack>

      <UserManagementDrawer
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        users={users}
        isLoading={organizationWithMembers.isLoading}
        onSave={handleSaveUsers}
        isSaving={isSaving}
        maxMembers={plan.maxMembers}
        currentPlanType={plan.type}
      />
    </SettingsLayout>
  );
}
