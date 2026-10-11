import { Drawer } from "@langwatch/design-system/drawer";
import {
  Badge,
  Button,
  Collapsible,
  HStack,
  Input,
  Separator,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
/**
 * User management drawer component
 * Manages ephemeral state for planning upgrades - does NOT save to DB
 */
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import type { MemberType } from "@langwatch/enterprise-licensing-contract";
import { nowInstant } from "@langwatch/time";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { type BillingInterval, type Currency, formatPrice } from "../../model/billing-plans.ts";
import {
  countFullMembers,
  type DrawerSaveResult,
  isValidEmail,
  type PendingInviteWithMemberType,
  type PlannedUser,
  type SubscriptionUser,
} from "../../model/subscription-types.ts";

let plannedUserSequence = 0;

function invalidEmailErrors(plannedUsers: PlannedUser[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const user of plannedUsers) {
    const trimmed = user.email.trim();
    if (trimmed !== "" && !isValidEmail(trimmed)) {
      errors[user.id] = "Please enter a valid email address";
    }
  }
  return errors;
}

/** One badge per seat. A Developer (ADR-171) is neither a Full seat nor a capped Lite seat. */
const SEAT_BADGE: Record<MemberType, { tone: string; label: string }> = {
  FullMember: { tone: "blue", label: "Full Member" },
  LiteMember: { tone: "yellow", label: "Lite Member" },
  Developer: { tone: "teal", label: "Developer" },
};

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

    const autoFillCount = maxSeats != null ? Math.max(0, maxSeats - occupiedFullMemberSeats) : 0;

    setInitialAutoFillCount(autoFillCount);

    const autoFilledRows: PlannedUser[] = Array.from({ length: autoFillCount }, (_, i) => ({
      id: `auto-${nowInstant().epochMilliseconds}-${i}`,
      email: "",
      memberType: "FullMember" as MemberType,
    }));

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
      id: `planned-${nowInstant().epochMilliseconds}-${plannedUserSequence++}`,
      email: "",
      memberType: "FullMember",
    };
    setLocalPlannedUsers((prev) => [...prev, newPlannedUser]);
  };

  const handleRemovePlannedUser = (id: string) => {
    setLocalPlannedUsers((prev) => prev.filter((u) => u.id !== id));
  };

  const handleUpdatePlannedUserEmail = (id: string, email: string) => {
    setLocalPlannedUsers((prev) => prev.map((u) => (u.id === id ? { ...u, email } : u)));
    setEmailErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleSave = () => {
    const errors = invalidEmailErrors(localPlannedUsers);
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
    <Drawer
      open={open}
      onClose={handleClose}
      size="lg"
      title="Manage seats"
      footer={{
        summary: (
          <VStack
            data-testid="drawer-footer-breakdown"
            align="stretch"
            gap={2}
            fontSize="sm"
            padding={4}
            bg="bg.subtle"
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
              <Text fontWeight="bold" color="blue.fg" data-testid="monthly-price-footer">
                {formatPrice({ cents: totalPriceCentsInDrawer, currency })}
                {periodSuffix}
              </Text>
            </HStack>
          </VStack>
        ),
        cancel: { label: "Cancel", onClick: handleClose },
        primaryAction: { label: "Done", onClick: handleSave },
      }}
    >
      {isLoading ? (
        <SkeletonRows rows={6} leading label="Loading members" />
      ) : (
        <VStack align="start" gap={6} width="full">
          {/* Current Members section - collapsible */}
          <CurrentMembersSection
            editableUsers={editableUsers}
            pendingInvitesWithMemberType={pendingInvitesWithMemberType}
          />

          {/* New Planned Seats section (editable) */}
          <VStack align="start" gap={3} width="full">
            <HStack justify="space-between" width="full">
              <Text fontWeight="semibold" fontSize="sm" color="fg.muted">
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
                  borderColor={emailErrors[user.id] ? "red.emphasized" : "border"}
                >
                  <Input
                    data-testid={`seat-email-${index}`}
                    placeholder="Enter email address"
                    size="sm"
                    flex={1}
                    value={user.email}
                    onChange={(e) => handleUpdatePlannedUserEmail(user.id, e.target.value)}
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
                  <Text fontSize="xs" color="red.fg" paddingLeft={3}>
                    {emailErrors[user.id]}
                  </Text>
                )}
              </VStack>
            ))}
          </VStack>
        </VStack>
      )}
    </Drawer>
  );
}

function CurrentMembersSection({
  editableUsers,
  pendingInvitesWithMemberType,
}: {
  editableUsers: SubscriptionUser[];
  pendingInvitesWithMemberType: PendingInviteWithMemberType[];
}) {
  return (
    <Collapsible.Root width="full">
      <HStack justify="flex-start" width="full">
        <Collapsible.Trigger asChild>
          <Button variant="ghost" size="xs" color="fg.muted" fontSize="xs">
            Show members ({editableUsers.length + pendingInvitesWithMemberType.length}
            )
            <ChevronDown size={12} />
          </Button>
        </Collapsible.Trigger>
      </HStack>
      <Collapsible.Content>
        <VStack as="ul" align="stretch" gap={0} width="full" listStyleType="none" padding={0}>
          {editableUsers.map((user) => (
            <MemberRow
              key={user.id}
              email={user.email}
              status="Active"
              memberType={user.memberType}
            />
          ))}
          {pendingInvitesWithMemberType.map((invite) => (
            <MemberRow
              key={invite.id}
              email={invite.email}
              status="Invited - Waiting for acceptance"
              memberType={invite.memberType}
              pending
            />
          ))}
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function MemberRow({
  email,
  status,
  memberType,
  pending = false,
}: {
  email: string;
  status: string;
  memberType: MemberType;
  pending?: boolean;
}) {
  return (
    <HStack
      as="li"
      justify="space-between"
      gap={4}
      paddingY={2}
      opacity={pending ? 0.8 : void 0}
      data-testid={pending ? `pending-invite-${email}` : void 0}
    >
      <VStack align="start" gap={0} minWidth={0}>
        <Text fontSize="sm" fontWeight="medium" color="fg">
          {email}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {status}
        </Text>
      </VStack>
      <Badge colorPalette={SEAT_BADGE[memberType].tone} variant="outline">
        {SEAT_BADGE[memberType].label}
      </Badge>
    </HStack>
  );
}
