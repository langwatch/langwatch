/**
 * User management drawer component
 * Manages ephemeral state for planning upgrades - does NOT save to DB
 */
import {
  Badge,
  Box,
  Button,
  Collapsible,
  Flex,
  HStack,
  Heading,
  Input,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Drawer } from "~/components/ui/drawer";
import { type MemberType } from "~/server/license-enforcement/member-classification";
import { type Currency, type BillingInterval, formatPrice } from "./billing-plans";
import {
  type PlannedUser,
  type SubscriptionUser,
  type PendingInviteWithMemberType,
  type DrawerSaveResult,
  isValidEmail,
  countFullMembers,
} from "./subscription-types";

export function UserManagementDrawer({
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
  billingPeriod: BillingInterval;
  currency: Currency;
  isLoading: boolean;
  onSave: (result: DrawerSaveResult) => void;
  maxSeats?: number;
}) {
  const [editableUsers, setEditableUsers] = useState<SubscriptionUser[]>([]);
  const [localPlannedUsers, setLocalPlannedUsers] = useState<PlannedUser[]>([]);
  const [emailErrors, setEmailErrors] = useState<Record<string, string>>({});
  const [initialAutoFillCount, setInitialAutoFillCount] = useState(0);
  const prevOpenRef = useRef(false);

  // Initialize state only when drawer transitions from closed to open
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (!justOpened) return;

    setEditableUsers([...users]);

    const occupiedFullMemberSeats =
      countFullMembers(users) +
      countFullMembers(pendingInvitesWithMemberType) +
      countFullMembers(plannedUsers);

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

  const totalFullMembersInDrawer =
    countFullMembers(editableUsers) +
    countFullMembers(pendingInvitesWithMemberType) +
    countFullMembers(localPlannedUsers);
  const totalPriceCentsInDrawer = totalFullMembersInDrawer * seatPricePerPeriodCents;
  const periodSuffix = billingPeriod === "annual" ? "/yr" : "/mo";
  const priceLabel = billingPeriod === "annual" ? "Annual Price:" : "Monthly Price:";

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
