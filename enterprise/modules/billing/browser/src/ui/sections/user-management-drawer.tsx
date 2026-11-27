/**
 * Manage seats: who is in the organization, who to invite, and the seats that takes. On Free
 * the confirm invites into Free or is the upgrade; on Growth it changes the seats in place.
 * @see specs/licensing/seat-buying.feature
 */
import { describeError } from "@langwatch/browser-host/errors";
import { Banner } from "@langwatch/design-system/banner";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  Badge,
  Box,
  Button,
  Collapsible,
  HStack,
  Input,
  Link,
  List,
  Separator,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { StatusChip } from "@langwatch/design-system/settings-card";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import type { DeveloperSeats } from "@langwatch/enterprise-billing-contract";
import type { MemberType } from "@langwatch/enterprise-licensing-contract";
import { nowInstant } from "@langwatch/time";
import { ChevronDown, ChevronRight, Clock, Info, Plus, Trash2 } from "lucide-react";
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
  FREE_SEAT_CHIP,
  freeSeatPlan,
  isBillingStuck,
  memberRoleWithArticle,
  GROWTH_SEATS_HINT,
  type GrowthSeatPlan,
  growthMinimumSeats,
  growthSeatPlan,
  type HeldSeats,
  type SeatAction,
  type SeatConfirm,
  type SeatPrice,
  seatChangeToast,
  seatConfirm,
  seatsAddedNoticeOf,
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
  BillingOnly: { tone: "gray", label: "Billing only" },
};

const PRICE_FAILED = "The price for this change did not load";

const filledEmails = (rows: InviteRow[]) =>
  rows.map((row) => row.email.trim()).filter((email) => email !== "");

const normalisedEmail = (email: string) => email.trim().toLowerCase();

const newInviteRow = (): InviteRow => ({
  id: `invite-${nowInstant().epochMilliseconds}-${inviteRowSequence++}`,
  email: "",
});

/** A typed address that belongs to someone already in the organization. */
export type MemberRefusal = { userId: string; message: string };

/** The members of the organization by lowercased address. */
function membersByEmailOf(users: SubscriptionUser[]): Map<string, SubscriptionUser> {
  return new Map(users.map((user) => [normalisedEmail(user.email), user]));
}

/** "Sam Lee is already on your team as a Lite Member." */
function alreadyMemberMessage(user: SubscriptionUser): string {
  const name = user.name.trim() || user.email;
  return `${name} is already on your team as ${memberRoleWithArticle(user)}.`;
}

/** The addresses that already belong to a member, by row: no seat is priced or bought for them. */
function memberErrorsOf({
  rows,
  members,
}: {
  rows: InviteRow[];
  members: ReadonlyMap<string, SubscriptionUser>;
}): Record<string, MemberRefusal> {
  const errors: Record<string, MemberRefusal> = {};
  for (const row of rows) {
    const member = members.get(normalisedEmail(row.email));
    if (member) errors[row.id] = { userId: member.userId, message: alreadyMemberMessage(member) };
  }
  return errors;
}

/** The addresses that are not emails, by row. */
function emailErrorsOf({ rows }: { rows: InviteRow[] }): Record<string, string> {
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

type AddedNotice = { title: string; body: string };

/** The footer's main button: the change, the Free invite or upgrade, Done after paying. */
function primaryActionOf({
  isGrowth,
  action,
  addedNotice,
}: {
  isGrowth: boolean;
  action: SeatAction;
  addedNotice: AddedNotice | undefined;
}): { label: string; isDone: boolean; idle: boolean } {
  // On Growth an invite goes from its own row, so the footer only changes seats.
  const idle = isGrowth && action.kind === "invite";
  if (idle || action.kind === "none") {
    return addedNotice
      ? { label: "Done", isDone: true, idle: false }
      : { label: "No changes", isDone: false, idle: true };
  }
  return { label: action.label, isDone: false, idle: false };
}

/**
 * A refusal keeps the confirm open; a refused invite keeps the drawer open for another try.
 * Added seats keep the drawer open with what was paid; any other change closes it.
 */
function settleCommit({
  outcome,
  growth,
  notice,
  onAdded,
  onClose,
}: {
  outcome: SeatCommitOutcome;
  growth: { closeConfirm: () => void };
  notice: AddedNotice | undefined;
  onAdded: (notice: AddedNotice) => void;
  onClose: () => void;
}) {
  if (outcome === "refused") return;
  growth.closeConfirm();
  if (outcome !== "committed") return;
  if (notice) onAdded(notice);
  else onClose();
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
  onOpenMember,
  isUpgradeLoading,
  organizationName,
}: {
  organizationName: string;
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
  /** Opens a member, so a refused address leads to changing their role. */
  onOpenMember?: (userId: string) => void;
  isUpgradeLoading: boolean;
}) {
  const isGrowth = mode.kind === "growth";
  const { rows, setRows, emailErrors, setEmailErrors, memberErrors, emails, validateRows } =
    useInviteRows({ open, isGrowth, users });
  const [isInviting, setIsInviting] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [addedNotice, setAddedNotice] = useState<AddedNotice | undefined>(undefined);
  useEffect(() => {
    if (open) setAddedNotice(undefined);
  }, [open]);
  const growth = useGrowthSeats({
    open,
    mode: mode.kind === "growth" ? mode : undefined,
    inUse,
    developersInUse,
    held,
    invites: emails.length,
    price,
  });

  const free = freePlanOf({ mode, inUse, held, invites: emails.length, price });
  const view = growth?.view ?? free;
  const action: SeatAction = view?.action ?? { kind: "none", label: "No changes" };

  const inviteNow = async () => {
    setIsInviting(true);
    try {
      if (!(await onInvite(emails))) return;
      if (!isGrowth) onClose();
      else setRows([newInviteRow()]);
    } finally {
      setIsInviting(false);
    }
  };

  const choose = () =>
    chooseAction({
      action,
      emails,
      validate: validateRows,
      inviteNow,
      onUpgrade,
      openConfirm: growth?.openConfirm,
    });

  const commit = async () => {
    if (!growth) return;
    setIsCommitting(true);
    try {
      settleCommit({
        outcome: await onCommit(growth.commitFor(emails)),
        growth,
        notice: growth.addedNoticeFor(emails),
        onAdded: (notice) => {
          setAddedNotice(notice);
          setRows([newInviteRow()]);
        },
        onClose,
      });
    } finally {
      setIsCommitting(false);
    }
  };

  const primary = primaryActionOf({ isGrowth, action, addedNotice });
  const disabledReason = primary.idle
    ? "Nothing has changed yet"
    : disabledReasonOf({ action, pendingReason: growth?.pendingReason });
  if (growth?.billingStuck && mode.kind === "growth") {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        size="lg"
        title="Manage seats"
        footer={{ primaryAction: { label: "Close", onClick: onClose } }}
      >
        <BillingStuckNotice
          organizationId={mode.organizationId}
          organizationName={organizationName}
          added={growth.seats - mode.paidSeats}
        />
      </Drawer>
    );
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        size="lg"
        title="Manage seats"
        busy={isInviting || isUpgradeLoading}
        footer={{
          summary: free ? <SeatSummaryLines lines={free.summary} /> : undefined,
          cancel: { label: isGrowth ? "Close" : "Cancel", onClick: onClose },
          primaryAction: {
            label: primary.label,
            onClick: () => void (primary.isDone ? onClose() : choose()),
            loading: isInviting || isUpgradeLoading,
            disabledReason: primary.isDone ? undefined : disabledReason,
          },
        }}
      >
        {isLoading ? (
          <SkeletonRows rows={6} leading label="Loading members" />
        ) : (
          <SeatDrawerBody
            growth={growth}
            view={view}
            addedNotice={addedNotice}
            users={users}
            pendingInvitesWithMemberType={pendingInvitesWithMemberType}
            price={price}
            invite={{
              rows,
              setRows,
              emailErrors: rowErrorsOf({ emailErrors, memberErrors }),
              memberErrors,
              setEmailErrors,
              onOpenMember,
              rowInvite: isGrowth
                ? {
                    enabled: action.kind === "invite" && !isInviting,
                    loading: isInviting,
                    onInvite: () => void choose(),
                  }
                : undefined,
            }}
          />
        )}
      </Drawer>
      {growth && (
        <SeatConfirmDialog
          confirm={growth.shownConfirm}
          onBack={growth.closeConfirm}
          onConfirm={() => void commit()}
          isCommitting={isCommitting}
          disabledReason={growth.pendingReason}
        />
      )}
    </>
  );
}

/** Runs the footer's or the row's action once every address is valid. */
async function chooseAction({
  action,
  emails,
  validate,
  inviteNow,
  onUpgrade,
  openConfirm,
}: {
  action: SeatAction;
  emails: string[];
  validate: () => boolean;
  inviteNow: () => Promise<void>;
  onUpgrade: (input: { seats: number; emails: string[] }) => Promise<void>;
  openConfirm: ((emails: string[]) => void) | undefined;
}) {
  if (!validate()) return;
  if (action.kind === "invite") return inviteNow();
  if (action.kind === "upgrade") return onUpgrade({ seats: action.seats, emails });
  if (action.kind === "change") openConfirm?.(emails);
}

/** The addresses typed into the drawer, their errors, and the ones that are real invites. */
function useInviteRows({
  open,
  isGrowth,
  users,
}: {
  open: boolean;
  isGrowth: boolean;
  users: SubscriptionUser[];
}) {
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [emailErrors, setEmailErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    // Growth invites one address at a time from its own row; Free plans several.
    setRows(isGrowth ? [newInviteRow()] : []);
    setEmailErrors({});
  }, [open, isGrowth]);

  const members = membersByEmailOf(users);
  const memberErrors = memberErrorsOf({ rows, members });
  // A member's address is no invite: it never counts toward the seats priced or bought.
  const emails = filledEmails(rows).filter((email) => !members.has(normalisedEmail(email)));
  return {
    rows,
    setRows,
    emailErrors,
    setEmailErrors,
    memberErrors,
    emails,
    /** False, with the errors shown, when an address needs fixing first. */
    validateRows: (): boolean => {
      const errors = emailErrorsOf({ rows });
      setEmailErrors(errors);
      return Object.keys(errors).length === 0 && Object.keys(memberErrors).length === 0;
    },
  };
}

/** The Free plan's view of the drawer; undefined on Growth. */
function freePlanOf({
  mode,
  inUse,
  held,
  invites,
  price,
}: {
  mode: SeatDrawerMode;
  inUse: number;
  held: HeldSeats;
  invites: number;
  price: SeatPrice;
}) {
  if (mode.kind !== "free") return undefined;
  return freeSeatPlan({ includedSeats: mode.includedSeats, inUse, held, invites, price });
}

/** Address errors, leaving out the rows a member's refusal already explains. */
function rowErrorsOf({
  emailErrors,
  memberErrors,
}: {
  emailErrors: Record<string, string>;
  memberErrors: Record<string, MemberRefusal>;
}): Record<string, string> {
  return Object.fromEntries(Object.entries(emailErrors).filter(([id]) => !(id in memberErrors)));
}

type InviteRowsState = {
  rows: InviteRow[];
  setRows: (update: (rows: InviteRow[]) => InviteRow[]) => void;
  emailErrors: Record<string, string>;
  memberErrors: Record<string, MemberRefusal>;
  setEmailErrors: (update: (errors: Record<string, string>) => Record<string, string>) => void;
  onOpenMember: ((userId: string) => void) | undefined;
  rowInvite: RowInvite | undefined;
};

/** Growth: the banner, the full seats and their price, then the invite and other seat types. */
function SeatDrawerBody({
  growth,
  view,
  addedNotice,
  users,
  pendingInvitesWithMemberType,
  price,
  invite,
}: {
  growth: GrowthSeats | undefined;
  view: { heading: string; rowChip: string; note: string | undefined } | undefined;
  addedNotice: AddedNotice | undefined;
  users: SubscriptionUser[];
  pendingInvitesWithMemberType: PendingInviteWithMemberType[];
  price: SeatPrice;
  invite: InviteRowsState;
}) {
  // A price that did not load leaves nothing to total, so the lines are left out.
  const priceFailed = growth?.priceFailed ?? false;
  return (
    <VStack align="stretch" gap={5} width="full">
      {addedNotice && (
        <Banner status="success" title={addedNotice.title} data-testid="seats-added-banner">
          {addedNotice.body}
        </Banner>
      )}
      <FullSeatsHeader view={view} growth={growth} />
      {growth?.view.changed && !priceFailed && <SeatSummaryLines lines={growth.view.summary} />}
      {growth && <SeatMinimumHint hint={GROWTH_SEATS_HINT} testId="seat-drawer-hint" />}
      <SeatDrawerNote priceFailed={priceFailed} priceError={growth?.priceError} note={view?.note} />
      {growth ? (
        <Separator />
      ) : (
        <CurrentMembersSection
          users={users}
          pendingInvitesWithMemberType={pendingInvitesWithMemberType}
        />
      )}
      <InviteSection single={growth !== undefined} chip={view?.rowChip ?? ""} {...invite} />
      {growth && <OtherSeatTypes growth={growth} price={price} />}
    </VStack>
  );
}

const STUCK_SUPPORT_MAIL = "mailto:support@langwatch.ai?subject=We%20couldn%27t%20add%20seats";

/**
 * Two live subscriptions hold the organization's billing: nothing is charged or changed, ops
 * were alerted, and a seat addition is kept once so the admin hears when it is fixed.
 */
function BillingStuckNotice({
  organizationId,
  organizationName,
  added,
}: {
  organizationId: string;
  organizationName: string;
  /** Seats beyond the paid count; zero or less for a reduction, which is not kept. */
  added: number;
}) {
  const record = billingApi.subscription.recordBlockedSeatPurchase.useMutation();
  const recordAttempt = record.mutate;
  const adding = added > 0;
  useEffect(() => {
    if (added > 0) recordAttempt({ organizationId, seats: added });
  }, [recordAttempt, organizationId, added]);
  return (
    <VStack align="start" gap={2} data-testid="seat-drawer-stuck">
      <Banner
        status="info"
        icon={<Clock size={16} />}
        title={adding ? "We couldn't add seats yet" : "We couldn't change seats yet"}
      >
        {`Something on our side is holding ${organizationName}'s billing. We were alerted automatically and are fixing it.`}
        <List.Root as="ul" paddingStart={4} marginTop={2}>
          <List.Item>Nothing was charged.</List.Item>
          {adding && (
            <List.Item>We'll email you when it's done, usually the same working day.</List.Item>
          )}
        </List.Root>
      </Banner>
      <Button asChild size="sm" variant="outline">
        <a href={STUCK_SUPPORT_MAIL}>Contact support</a>
      </Button>
    </VStack>
  );
}

function SeatDrawerNote({
  priceFailed,
  priceError,
  note,
}: {
  priceFailed: boolean;
  priceError: unknown;
  note: string | undefined;
}) {
  if (priceFailed) {
    return (
      <Banner status="error" data-testid="seat-drawer-price-failed">
        {describeError({
          error: priceError,
          fallbackTitle: "The price for this change did not load",
        })}
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
  view,
  growth,
}: {
  view: { heading: string } | undefined;
  growth: GrowthSeats | undefined;
}) {
  const freeSeats = growth?.view.freeSeats ?? 0;
  return (
    <VStack align="stretch" gap={2}>
      <HStack justify="space-between" align="center">
        <VStack align="start" gap={0}>
          <Text fontWeight="semibold">Full seats</Text>
          <Text textStyle="bodySm" color="fg.muted" data-testid="seat-drawer-heading">
            {view?.heading}
            {freeSeats > 0 && (
              <>
                {" "}
                <Text
                  as="span"
                  color="green.fg"
                  fontWeight="semibold"
                  data-testid="seat-drawer-free"
                >
                  {freeSeats} free
                </Text>
              </>
            )}
          </Text>
        </VStack>
        {growth && (
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
        <SeatMinimumHint hint={growth.view.minimumHint} testId="seat-drawer-minimum" />
      )}
    </VStack>
  );
}

function SeatMinimumHint({ hint, testId }: { hint: string; testId: string }) {
  return (
    <HStack gap={2} align="start" color="fg.muted" data-testid={testId}>
      <Box flexShrink={0} paddingTop={0.5}>
        <Info size={14} />
      </Box>
      <Text textStyle="bodySm">{hint}</Text>
    </HStack>
  );
}

type RowInvite = { enabled: boolean; loading: boolean; onInvite: () => void };

function InviteSection({
  single,
  rows,
  setRows,
  emailErrors,
  memberErrors,
  setEmailErrors,
  chip,
  onOpenMember,
  rowInvite,
}: InviteRowsState & {
  /** One address with its own Invite button (Growth), or a list that the confirm sends (Free). */
  single: boolean;
  chip: string;
}) {
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
          {single ? "Invite someone new" : "Invite"}
        </Text>
        {!single && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setRows((prev) => [...prev, newInviteRow()])}
            data-testid="add-invite-row"
          >
            <Plus size={14} />
            Add person
          </Button>
        )}
      </HStack>
      {rows.map((row, index) => (
        <InviteRowField
          key={row.id}
          row={row}
          index={index}
          single={single}
          error={emailErrors[row.id]}
          refusal={memberErrors[row.id]}
          chip={chip}
          onEmail={(email) => setEmail(row.id, email)}
          onRemove={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
          onOpenMember={onOpenMember}
          invite={rowInvite}
        />
      ))}
    </VStack>
  );
}

function InviteRowField({
  row,
  index,
  single,
  error,
  refusal,
  chip,
  onEmail,
  onRemove,
  onOpenMember,
  invite,
}: {
  row: InviteRow;
  index: number;
  single: boolean;
  error: string | undefined;
  refusal: MemberRefusal | undefined;
  chip: string;
  onEmail: (email: string) => void;
  onRemove: () => void;
  onOpenMember: ((userId: string) => void) | undefined;
  invite: RowInvite | undefined;
}) {
  const filled = row.email.trim() !== "";
  const showChip = filled && !refusal && !error;
  return (
    <VStack align="stretch" gap={1}>
      <HStack
        data-testid={`invite-row-${index}`}
        gap={2}
        padding={single ? 0 : 2}
        borderWidth={single ? 0 : "1px"}
        borderRadius="md"
        borderColor={error || refusal ? "red.emphasized" : "border"}
      >
        <Input
          data-testid={`seat-email-${index}`}
          placeholder="name@company.com"
          aria-label="Email address"
          aria-invalid={error || refusal ? true : undefined}
          size="sm"
          flex={1}
          value={row.email}
          onChange={(event) => onEmail(event.target.value)}
        />
        <Badge colorPalette="blue" variant="outline">
          {single ? "Member" : "Full Member"}
        </Badge>
        {showChip && (
          <Badge
            colorPalette={chip === FREE_SEAT_CHIP ? "green" : "blue"}
            variant="subtle"
            data-testid={`invite-chip-${index}`}
          >
            {chip}
          </Badge>
        )}
        {invite ? (
          <Button
            size="xs"
            variant={invite.enabled ? "solid" : "outline"}
            disabled={!invite.enabled}
            loading={invite.loading}
            onClick={invite.onInvite}
            data-testid={`invite-now-${index}`}
          >
            Invite
          </Button>
        ) : (
          <Button
            data-testid={`remove-invite-${index}`}
            aria-label="Remove"
            size="xs"
            variant="ghost"
            colorPalette="red"
            onClick={onRemove}
          >
            <Trash2 size={14} />
          </Button>
        )}
      </HStack>
      <InviteRowError error={error} refusal={refusal} onOpenMember={onOpenMember} />
    </VStack>
  );
}

function InviteRowError({
  error,
  refusal,
  onOpenMember,
}: {
  error: string | undefined;
  refusal: MemberRefusal | undefined;
  onOpenMember: ((userId: string) => void) | undefined;
}) {
  if (refusal) {
    return (
      <Text fontSize="xs" color="red.fg" data-testid="invite-member-refusal">
        {refusal.message}{" "}
        {onOpenMember ? (
          <Link
            as="button"
            color="red.fg"
            textDecoration="underline"
            onClick={() => onOpenMember(refusal.userId)}
          >
            Change their role instead
          </Link>
        ) : (
          "Change their role instead"
        )}
        .
      </Text>
    );
  }
  if (!error) return null;
  return (
    <Text fontSize="xs" color="red.fg">
      {error}
    </Text>
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
            <SeatMinimumHint hint={growth.developerHint} testId="developer-seats-minimum" />
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
  // The confirm as it was when opened: a payment re-reads the plan, and the dialog must not
  // turn into a different question while the invites after it are still being sent.
  const [shownConfirm, setShownConfirm] = useState<SeatConfirm | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    setRequested(paid);
    setDeveloperTarget(undefined);
  }, [open, paid]);
  useEffect(() => {
    if (!open) setShownConfirm(undefined);
  }, [open]);

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
    /** Billing is held on our side, so no seat count or price can be trusted. */
    billingStuck: isBillingStuck(seatQuote.error),
    view: growthSeatPlan({ ...plan, priceFailed: pendingReason === PRICE_FAILED }),
    pendingReason,
    priceFailed: pendingReason === PRICE_FAILED,
    priceError: seatQuote.error ?? developerQuote.error,
    shownConfirm,
    addedNoticeFor: (emails: string[]) => seatsAddedNoticeOf({ plan, emails }),
    openConfirm: (emails: string[]) =>
      setShownConfirm(seatConfirm({ plan, emails, todayMs: nowInstant().epochMilliseconds })),
    closeConfirm: () => setShownConfirm(undefined),
    commitFor: (emails: string[]) =>
      commitOf({ plan, emails, day, developerQuotedAt: developerQuote.data?.quotedAt }),
  };
}

/** The change the confirm commits: full seats, Developer seats, and who to invite after. */
function commitOf({
  plan,
  emails,
  day,
  developerQuotedAt,
}: {
  plan: GrowthSeatPlan;
  emails: string[];
  day: string | undefined;
  developerQuotedAt: number | undefined;
}): SeatCommit {
  const { paid, seats, developer, quote } = plan;
  const developerChanged = developer !== undefined && developer.target !== developer.current;
  return {
    seats: seats === paid ? undefined : seats,
    quotedAt: quote?.quotedAt,
    developer: developerChanged
      ? { quantity: developer.target, quotedAt: developerQuotedAt }
      : undefined,
    emails,
    // Added seats are told in the drawer's own banner, so no toast repeats them.
    successTitle:
      seats > paid ? undefined : seatChangeToast({ paid, seats, emails, day, developer }),
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
