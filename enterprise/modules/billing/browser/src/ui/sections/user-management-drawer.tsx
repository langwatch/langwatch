/**
 * Manage seats: who is in the organization, who to invite, and the seats that takes. On Free
 * the confirm invites into Free or is the upgrade; on Growth it changes the seats in place.
 * @see specs/licensing/seat-buying.feature
 */
import { Banner } from "@langwatch/design-system/banner";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  Badge,
  Box,
  Button,
  Collapsible,
  HStack,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { StatusChip } from "@langwatch/design-system/settings-card";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import type { DeveloperSeats } from "@langwatch/enterprise-billing-contract";
import type { MemberType } from "@langwatch/enterprise-licensing-contract";
import { nowInstant } from "@langwatch/time";
import { ChevronDown, ChevronRight, Info, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { billingApi } from "../../behavior/billing-api.ts";
import { seatQuoteOf } from "../../model/seat-change-summary.ts";
import {
  billingDayOrUndefined,
  type DeveloperSeatPlan,
  developerMinimumHint,
  developerSeatHint,
  developerSeatMinimum,
  developerTargetWithin,
  freeSeatPlan,
  type GrowthSeatPlan,
  growthMinimumSeats,
  growthSeatPlan,
  type HeldSeats,
  type SeatAction,
  type SeatPrice,
  seatChangeToast,
  seatConfirm,
  snapDeveloperTarget,
} from "../../model/seat-purchase.ts";
import {
  isValidEmail,
  type PendingInviteWithMemberType,
  type SubscriptionUser,
} from "../../model/subscription-types.ts";
import { SeatConfirmDialog } from "../blocks/seat-confirm-dialog.tsx";
import { SeatSummaryLines } from "../blocks/seat-summary-lines.tsx";
import { SeatStepper } from "../elements/seat-stepper.tsx";
import type { SeatCommit, SeatCommitOutcome } from "./use-seat-purchase.ts";

let inviteRowSequence = 0;

type InviteRow = { id: string; email: string };

/** How the drawer's confirm moves the plan. */
export type SeatDrawerMode =
  | { kind: "free"; includedSeats: number }
  | { kind: "growth"; organizationId: string; paidSeats: number };

/** A Growth plan whose seat count the drawer changes at the payment provider. */
export type DrawerSeatChange = {
  organizationId: string;
  /** The seats the plan grants now. */
  currentSeats: number;
};

/** One badge per seat. A Developer (ADR-171) is neither a Full seat nor a capped Lite seat. */
const SEAT_BADGE: Record<MemberType, { tone: string; label: string }> = {
  FullMember: { tone: "blue", label: "Full Member" },
  LiteMember: { tone: "yellow", label: "Lite Member" },
  Developer: { tone: "teal", label: "Developer" },
};

const PRICE_FAILED = "The price for this change did not load";

const filledEmails = (rows: InviteRow[]) =>
  rows.map((row) => row.email.trim()).filter((email) => email !== "");

/** The addresses that are not emails, by row. */
function emailErrorsOf(rows: InviteRow[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const row of rows) {
    const trimmed = row.email.trim();
    if (trimmed !== "" && !isValidEmail(trimmed)) {
      errors[row.id] = "Please enter a valid email address";
    }
  }
  return errors;
}

function disabledReasonOf({
  action,
  pendingReason,
}: {
  action: SeatAction;
  pendingReason: string | undefined;
}): string | undefined {
  if (action.kind === "none") return "Nothing has changed yet";
  if (action.kind === "change") return pendingReason;
  return undefined;
}

/** A refusal keeps the confirm open; a refused invite keeps the drawer open for another try. */
function settleCommit({
  outcome,
  growth,
  onClose,
}: {
  outcome: SeatCommitOutcome;
  growth: { closeConfirm: () => void };
  onClose: () => void;
}) {
  if (outcome === "refused") return;
  growth.closeConfirm();
  if (outcome === "committed") onClose();
}

export function UserManagementDrawer({
  open,
  onClose,
  users,
  pendingInvitesWithMemberType,
  isLoading,
  mode,
  inUse,
  developersInUse,
  held,
  price,
  onInvite,
  onUpgrade,
  onCommit,
  isUpgradeLoading,
}: {
  open: boolean;
  onClose: () => void;
  users: SubscriptionUser[];
  pendingInvitesWithMemberType: PendingInviteWithMemberType[];
  isLoading: boolean;
  mode: SeatDrawerMode;
  /** Full seats held now, members and open invites as enforcement counts them. */
  inUse: number;
  /** Developer seats held now, members and open invites, the floor the server enforces. */
  developersInUse: number;
  /** Of `inUse`, the seats held for people who left a full seat, as the server lists them. */
  held: HeldSeats;
  price: SeatPrice;
  onInvite: (emails: string[]) => Promise<boolean>;
  onUpgrade: (input: { seats: number; emails: string[] }) => Promise<void>;
  onCommit: (change: SeatCommit) => Promise<SeatCommitOutcome>;
  isUpgradeLoading: boolean;
}) {
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [emailErrors, setEmailErrors] = useState<Record<string, string>>({});
  const [isInviting, setIsInviting] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setEmailErrors({});
  }, [open]);

  const emails = filledEmails(rows);
  const growth = useGrowthSeats({
    open,
    mode: mode.kind === "growth" ? mode : undefined,
    inUse,
    developersInUse,
    held,
    invites: emails.length,
    price,
  });

  const free =
    mode.kind === "free"
      ? freeSeatPlan({
          includedSeats: mode.includedSeats,
          inUse,
          held,
          invites: emails.length,
          price,
        })
      : undefined;
  const view = growth?.view ?? free;
  const action: SeatAction = view?.action ?? { kind: "none", label: "No changes" };

  /** False, with the errors shown, when an address needs fixing first. */
  const validateRows = (): boolean => {
    const errors = emailErrorsOf(rows);
    setEmailErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const inviteNow = async () => {
    setIsInviting(true);
    try {
      if (await onInvite(emails)) onClose();
    } finally {
      setIsInviting(false);
    }
  };

  const choose = async () => {
    if (!validateRows()) return;
    if (action.kind === "invite") return inviteNow();
    if (action.kind === "upgrade") {
      await onUpgrade({ seats: action.seats, emails });
      return;
    }
    if (action.kind === "change") growth?.openConfirm();
  };

  const commit = async () => {
    if (!growth) return;
    setIsCommitting(true);
    try {
      settleCommit({ outcome: await onCommit(growth.commitFor(emails)), growth, onClose });
    } finally {
      setIsCommitting(false);
    }
  };

  const disabledReason = disabledReasonOf({ action, pendingReason: growth?.pendingReason });

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        size="lg"
        title="Manage seats"
        busy={isInviting || isUpgradeLoading}
        footer={{
          summary: view ? <SeatSummaryLines lines={view.summary} /> : undefined,
          cancel: { label: "Cancel", onClick: onClose },
          primaryAction: {
            label: action.label,
            onClick: () => void choose(),
            loading: isInviting || isUpgradeLoading,
            disabledReason,
          },
        }}
      >
        {isLoading ? (
          <SkeletonRows rows={6} leading label="Loading members" />
        ) : (
          <VStack align="stretch" gap={5} width="full">
            <FullSeatsHeader mode={mode} view={view} growth={growth} />
            <CurrentMembersSection
              users={users}
              pendingInvitesWithMemberType={pendingInvitesWithMemberType}
            />
            <InviteSection
              rows={rows}
              setRows={setRows}
              emailErrors={emailErrors}
              setEmailErrors={setEmailErrors}
              chip={view?.rowChip ?? ""}
            />
            {growth && <OtherSeatTypes growth={growth} price={price} />}
            <SeatDrawerNote priceFailed={growth?.priceFailed ?? false} note={view?.note} />
          </VStack>
        )}
      </Drawer>
      {growth && (
        <SeatConfirmDialog
          confirm={growth.confirmOpen ? growth.confirm(emails) : undefined}
          onBack={growth.closeConfirm}
          onConfirm={() => void commit()}
          isCommitting={isCommitting}
          disabledReason={growth.pendingReason}
        />
      )}
    </>
  );
}

function SeatDrawerNote({ priceFailed, note }: { priceFailed: boolean; note: string | undefined }) {
  if (priceFailed) {
    return (
      <Banner status="error" data-testid="seat-drawer-price-failed">
        The price for this change did not load. Close Manage seats and try again.
      </Banner>
    );
  }
  if (!note) return null;
  return (
    <Banner status="info" data-testid="seat-drawer-note">
      {note}
    </Banner>
  );
}

function FullSeatsHeader({
  mode,
  view,
  growth,
}: {
  mode: SeatDrawerMode;
  view: { heading: string } | undefined;
  growth: GrowthSeats | undefined;
}) {
  return (
    <VStack align="stretch" gap={2}>
      <HStack justify="space-between" align="center">
        <VStack align="start" gap={0}>
          <Text fontWeight="semibold">Full seats</Text>
          <Text textStyle="bodySm" color="fg.muted" data-testid="seat-drawer-heading">
            {view?.heading}
          </Text>
        </VStack>
        {mode.kind === "growth" && growth && (
          <SeatStepper
            value={growth.seats}
            minimum={growth.minimum}
            onChange={growth.setRequested}
            label="Full seats"
            testId="drawer-seats-stepper"
          />
        )}
      </HStack>
      {growth?.view.minimumHint && (
        <HStack gap={2} align="start" color="fg.muted" data-testid="seat-drawer-minimum">
          <Box flexShrink={0} paddingTop={0.5}>
            <Info size={14} />
          </Box>
          <Text textStyle="bodySm">{growth.view.minimumHint}</Text>
        </HStack>
      )}
    </VStack>
  );
}

function InviteSection({
  rows,
  setRows,
  emailErrors,
  setEmailErrors,
  chip,
}: {
  rows: InviteRow[];
  setRows: (update: (rows: InviteRow[]) => InviteRow[]) => void;
  emailErrors: Record<string, string>;
  setEmailErrors: (update: (errors: Record<string, string>) => Record<string, string>) => void;
  chip: string;
}) {
  const addRow = () =>
    setRows((prev) => [
      ...prev,
      { id: `invite-${nowInstant().epochMilliseconds}-${inviteRowSequence++}`, email: "" },
    ]);
  const setEmail = (id: string, email: string) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, email } : row)));
    setEmailErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  return (
    <VStack align="stretch" gap={3}>
      <HStack justify="space-between">
        <Text fontWeight="semibold" fontSize="xs" color="fg.muted" textTransform="uppercase">
          Invite
        </Text>
        <Button variant="ghost" size="xs" onClick={addRow} data-testid="add-invite-row">
          <Plus size={14} />
          Add person
        </Button>
      </HStack>
      {rows.map((row, index) => (
        <VStack key={row.id} align="stretch" gap={1}>
          <HStack
            data-testid={`invite-row-${index}`}
            gap={2}
            padding={2}
            borderWidth="1px"
            borderRadius="md"
            borderColor={emailErrors[row.id] ? "red.emphasized" : "border"}
          >
            <Input
              data-testid={`seat-email-${index}`}
              placeholder="Email address"
              aria-label="Email address"
              size="sm"
              flex={1}
              value={row.email}
              onChange={(event) => setEmail(row.id, event.target.value)}
            />
            <Badge colorPalette="blue" variant="outline">
              Full Member
            </Badge>
            {row.email.trim() !== "" && (
              <Badge colorPalette="blue" variant="subtle" data-testid={`invite-chip-${index}`}>
                {chip}
              </Badge>
            )}
            <Button
              data-testid={`remove-invite-${index}`}
              aria-label="Remove"
              size="xs"
              variant="ghost"
              colorPalette="red"
              onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
            >
              <Trash2 size={14} />
            </Button>
          </HStack>
          {emailErrors[row.id] && (
            <Text fontSize="xs" color="red.fg" paddingLeft={3}>
              {emailErrors[row.id]}
            </Text>
          )}
        </VStack>
      ))}
    </VStack>
  );
}

function OtherSeatTypes({ growth, price }: { growth: GrowthSeats; price: SeatPrice }) {
  const [open, setOpen] = useState(false);
  const developer = growth.developer;
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={(details) => setOpen(details.open)}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      data-testid="other-seat-types"
    >
      <Collapsible.Trigger asChild>
        <Button variant="ghost" size="sm" width="full" justifyContent="flex-start">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Other seat types
        </Button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <VStack align="stretch" gap={3} paddingX={4} paddingBottom={3}>
          <HStack justify="space-between" data-testid="seat-type-lite">
            <VStack align="start" gap={0}>
              <Text fontWeight="medium">Lite members</Text>
              <Text textStyle="bodySm" color="fg.muted">
                Read only. Free and unlimited on Growth.
              </Text>
            </VStack>
            <StatusChip label="Free" tone="good" />
          </HStack>
          {developer && (
            <HStack justify="space-between" data-testid="seat-type-developer">
              <VStack align="start" gap={0}>
                <Text fontWeight="medium">Developers</Text>
                <Text textStyle="bodySm" color="fg.muted">
                  {developerSeatHint({ price, unitCents: developer.unitCents })}
                </Text>
              </VStack>
              <SeatStepper
                value={developer.target}
                minimum={growth.developerMinimum}
                onChange={growth.setDeveloperTarget}
                label="Developer seats"
                testId="developer-seats-stepper"
              />
            </HStack>
          )}
          {growth.developerHint && (
            <HStack gap={2} align="start" color="fg.muted" data-testid="developer-seats-minimum">
              <Box flexShrink={0} paddingTop={0.5}>
                <Info size={14} />
              </Box>
              <Text textStyle="bodySm">{growth.developerHint}</Text>
            </HStack>
          )}
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

type GrowthSeats = NonNullable<ReturnType<typeof useGrowthSeats>>;

/** Why the confirm waits on a quote, if it does. */
function quoteReason({ needed, failed }: { needed: boolean; failed: boolean }) {
  if (!needed) return undefined;
  return failed ? PRICE_FAILED : "Loading the price for this change";
}

/** Developer seats as the drawer plans them; undefined while none are sold. */
function developerPlanOf({
  seats,
  target,
  inUse,
}: {
  seats: DeveloperSeats | undefined;
  target: number | undefined;
  inUse: number;
}): DeveloperSeatPlan | undefined {
  if (!seats?.available || seats.unitAmountCents === null) return undefined;
  const current = seats.quantity;
  return {
    current,
    target: developerTargetWithin({ target: target ?? current, current, inUse }),
    unitCents: seats.unitAmountCents,
  };
}

/** The Growth seat count, its Developer seats, their quotes, and the confirm that commits them. */
function useGrowthSeats({
  open,
  mode,
  inUse,
  developersInUse,
  held,
  invites,
  price,
}: {
  open: boolean;
  mode: Extract<SeatDrawerMode, { kind: "growth" }> | undefined;
  inUse: number;
  developersInUse: number;
  held: HeldSeats;
  invites: number;
  price: SeatPrice;
}) {
  const paid = mode?.paidSeats ?? 0;
  const [requested, setRequested] = useState(paid);
  const [developerTarget, setDeveloperTarget] = useState<number | undefined>(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    setRequested(paid);
    setDeveloperTarget(undefined);
    setConfirmOpen(false);
  }, [open, paid]);

  const minimum = growthMinimumSeats({ inUse, invites });
  const seats = Math.max(requested, minimum);
  const organizationId = mode?.organizationId ?? "";
  const developerSeats = billingApi.subscription.developerSeats.useQuery(
    { organizationId },
    { enabled: open && mode !== undefined },
  );
  const refetchDeveloperSeats = developerSeats.refetch;
  const isGrowth = mode !== undefined;
  useEffect(() => {
    if (open && isGrowth) void refetchDeveloperSeats();
  }, [open, isGrowth, refetchDeveloperSeats]);
  const developer = developerPlanOf({
    seats: developerSeats.data,
    target: developerTarget,
    inUse: developersInUse,
  });
  const developerAdded = developer ? developer.target > developer.current : false;
  const seatsChanged = seats !== paid;

  const seatQuote = billingApi.subscription.previewProration.useQuery(
    { organizationId, newTotalSeats: Math.max(1, seats) },
    { enabled: open && mode !== undefined && seatsChanged },
  );
  const developerQuote = billingApi.subscription.previewDeveloperSeats.useQuery(
    { organizationId, quantity: developer?.target ?? 0 },
    { enabled: open && mode !== undefined && developerAdded },
  );
  if (!mode) return undefined;

  const quote = seatsChanged ? seatQuoteOf(seatQuote.data) : undefined;
  const plan: GrowthSeatPlan = {
    paid,
    seats,
    inUse,
    held,
    invites,
    price,
    quote,
    developer,
    developerDueCents: developerAdded ? developerQuote.data?.amountDueCents : 0,
    developerTaxCents: developerAdded ? developerQuote.data?.taxCents : 0,
    periodEndsAt: developerSeats.data?.periodEndsAt ?? undefined,
  };
  const pendingReason =
    quoteReason({ needed: seatsChanged && !quote, failed: seatQuote.isError }) ??
    quoteReason({ needed: developerAdded && !developerQuote.data, failed: developerQuote.isError });
  const day = billingDayOrUndefined(quote?.appliesAt ?? plan.periodEndsAt);

  const developerFloor = developer
    ? { current: developer.current, inUse: developersInUse }
    : { current: 0, inUse: 0 };
  return {
    seats,
    minimum,
    setRequested,
    developer,
    setDeveloperTarget: (next: number) =>
      setDeveloperTarget(
        snapDeveloperTarget({ ...developerFloor, previous: developer?.target ?? 0, next }),
      ),
    developerMinimum: developerSeatMinimum(developerFloor),
    developerHint: developer
      ? developerMinimumHint({ ...developerFloor, target: developer.target })
      : undefined,
    view: growthSeatPlan(plan),
    pendingReason,
    priceFailed: pendingReason === PRICE_FAILED,
    confirmOpen,
    openConfirm: () => setConfirmOpen(true),
    closeConfirm: () => setConfirmOpen(false),
    confirm: (emails: string[]) =>
      seatConfirm({ plan, emails, todayMs: nowInstant().epochMilliseconds }),
    commitFor: (emails: string[]): SeatCommit => {
      const developerChanged = developer && developer.target !== developer.current;
      return {
        seats: seatsChanged ? seats : undefined,
        quotedAt: quote?.quotedAt,
        developer: developerChanged
          ? { quantity: developer.target, quotedAt: developerQuote.data?.quotedAt }
          : undefined,
        emails,
        successTitle: seatChangeToast({ paid, seats, emails, day, developer }),
      };
    },
  };
}

function CurrentMembersSection({
  users,
  pendingInvitesWithMemberType,
}: {
  users: SubscriptionUser[];
  pendingInvitesWithMemberType: PendingInviteWithMemberType[];
}) {
  return (
    <Collapsible.Root width="full">
      <HStack justify="flex-start" width="full">
        <Collapsible.Trigger asChild>
          <Button variant="ghost" size="xs" color="fg.muted" fontSize="xs">
            Show members ({users.length + pendingInvitesWithMemberType.length})
            <ChevronDown size={12} />
          </Button>
        </Collapsible.Trigger>
      </HStack>
      <Collapsible.Content>
        <VStack as="ul" align="stretch" gap={0} width="full" listStyleType="none" padding={0}>
          {users.map((user) => (
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
              status="Invited, waiting for acceptance"
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
