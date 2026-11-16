/**
 * What the Manage seats drawer and its confirm say and do: on Free it invites into Free and
 * becomes the upgrade past it; on Growth it adds or lowers seats in place.
 * @see specs/licensing/seat-buying.feature
 */
import { Temporal } from "@langwatch/time";

import { type Currency, EXCLUDING_VAT, formatPrice } from "./billing-plans.ts";
import { billingDay, type SeatQuote } from "./seat-change-summary.ts";

export type SeatSummaryLine = {
  label: string;
  value: string;
  /** Quiet words beside the value: "excl. VAT", or how a charge splits into price and VAT. */
  note?: string;
  muted?: boolean;
  /** A rule above this line: the total under the breakdown. */
  ruled?: boolean;
  /** The line the change is about, drawn in the accent. */
  emphasis?: boolean;
};

/** What the drawer's confirm does when chosen. */
export type SeatAction =
  | { kind: "none"; label: string }
  | { kind: "invite"; label: string }
  | { kind: "upgrade"; label: string; seats: number }
  | { kind: "change"; label: string };

export type SeatPrice = {
  /** Per full seat per billing period, minor unit. */
  seatCents: number;
  currency: Currency;
  /** "/mo" or "/yr". */
  periodSuffix: string;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);
/** "1 person uses", "2 people use": the count and its verb in agreement. */
const peopleUse = (n: number) => `${people(n)} ${n === 1 ? "uses" : "use"}`;
const money = (price: SeatPrice, cents: number) => formatPrice({ cents, currency: price.currency });
/** "excl. VAT" beside a recurring price; nothing beside a free one. */
const recurringNote = (cents: number) => (cents > 0 ? EXCLUDING_VAT : undefined);

/** "€24.17 + €5.07 VAT" under a charge that carries VAT; undefined for one that carries none. */
export function vatSplit({
  price,
  dueCents,
  taxCents,
}: {
  price: SeatPrice;
  dueCents: number | undefined;
  taxCents: number;
}): string | undefined {
  if (dueCents === undefined || dueCents <= 0 || taxCents <= 0) return undefined;
  return `${money(price, dueCents - taxCents)} + ${money(price, taxCents)} VAT`;
}

/** A billing day, "1 Dec", or undefined when the instant is unknown. */
export function billingDayOrUndefined(at: number | null | undefined): string | undefined {
  return at == null ? undefined : billingDay(at);
}

/** The Developer row's line under its name. */
export function developerSeatHint({ price, unitCents }: { price: SeatPrice; unitCents: number }) {
  return `Their own project only, nothing shared. ${money(price, unitCents)}${price.periodSuffix} each.`;
}

/** The Developer stepper's floor: the Developers in use, never above the seats billed now. */
export function developerSeatMinimum({ current, inUse }: { current: number; inUse: number }) {
  return Math.min(current, inUse);
}

type DeveloperFloor = { current: number; inUse: number };

/** A pick under the floor, made before the Developers in use were counted, lifted to it. */
export function developerTargetWithin({ target, ...floor }: DeveloperFloor & { target: number }) {
  return Math.max(target, developerSeatMinimum(floor));
}

/** The stepper's next count, skipping the counts the server refuses: under use and not billed. */
export function snapDeveloperTarget({
  previous,
  next,
  current,
  inUse,
}: DeveloperFloor & { previous: number; next: number }) {
  if (next === current || next >= inUse) return next;
  return next > previous ? inUse : Math.min(current, previous);
}

/** Why the Developer stepper stopped where it did, once it reaches the Developers in use. */
export function developerMinimumHint({
  target,
  current,
  inUse,
}: DeveloperFloor & { target: number }): string | undefined {
  if (inUse === 0 || target !== inUse || target === current) return undefined;
  return target < current
    ? `${peopleUse(inUse)} Developer seats. Remove someone in Users to go lower.`
    : `${peopleUse(inUse)} Developer seats, so you need at least ${inUse}.`;
}

/** "€87/mo", "excl. VAT" and "3 seats × €29", the seat dialog's live total. */
export function upgradeTotal({ seats, price }: { seats: number; price: SeatPrice }) {
  return {
    total: `${money(price, seats * price.seatCents)}${price.periodSuffix}`,
    note: EXCLUDING_VAT,
    breakdown: `${plural(seats, "seat")} × ${money(price, price.seatCents)}`,
  };
}

/** Full seats still held for someone who left one, and the day the first of them frees. */
export type HeldSeats = { count: 0 } | { count: number; firstFreesOn: string };

export const noHeldSeats: HeldSeats = { count: 0 };

/** One hold as the server lists it: removed, disabled or demoted. */
export type SeatHold = { userId: string; email: string | null; seatFreesAt: string };

/** "7 Dec": the day a held seat frees, in the reader's own calendar, as the Users list says it. */
function holdFreesOn(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toLocaleString("en-GB", { day: "numeric", month: "short" });
}

/**
 * The holds `inUse` counts: a hold whose person holds a full seat again, as a member or a
 * pending invite, is counted once, as that seat (entitlement's `countMemberSeats`).
 */
export function heldSeatsOf({
  holds,
  fullMemberIds,
  fullInviteEmails,
}: {
  holds: readonly SeatHold[];
  fullMemberIds: ReadonlySet<string>;
  fullInviteEmails: ReadonlySet<string>;
}): HeldSeats {
  const counted = holds.filter(
    (hold) =>
      !fullMemberIds.has(hold.userId) &&
      !(hold.email && fullInviteEmails.has(hold.email.toLowerCase())),
  );
  if (counted.length === 0) return noHeldSeats;
  const first = Math.min(
    ...counted.map((hold) => Temporal.Instant.from(hold.seatFreesAt).epochMilliseconds),
  );
  return { count: counted.length, firstFreesOn: holdFreesOn(first) };
}

/** "2 in use." or "2 in use, 1 of them held until 7 Dec." */
function inUseLine({ inUse, held }: { inUse: number; held: HeldSeats }): string {
  if (!("firstFreesOn" in held)) return `${inUse} in use.`;
  if (held.count === 1) return `${inUse} in use, 1 of them held until ${held.firstFreesOn}.`;
  return `${inUse} in use, ${held.count} of them held, the first until ${held.firstFreesOn}.`;
}

export function upgradeMinimumHint(minimum: number): string | undefined {
  if (minimum <= 1) return undefined;
  return `${minimum} people are already in your organization, so you need at least ${minimum} full seats.`;
}

export type FreeSeatPlan = {
  includedSeats: number;
  inUse: number;
  /** Of `inUse`, the seats held for people who left a full seat. */
  held?: HeldSeats;
  invites: number;
  price: SeatPrice;
};

function freeSeatAction({
  invites,
  total,
  over,
  price,
}: {
  invites: number;
  total: number;
  over: boolean;
  price: SeatPrice;
}): SeatAction {
  if (invites === 0) return { kind: "none", label: "No changes" };
  if (!over) return { kind: "invite", label: `Invite ${people(invites)}` };
  return {
    kind: "upgrade",
    seats: total,
    label: `Upgrade and invite ${people(invites)} · ${money(price, total * price.seatCents)}${price.periodSuffix}`,
  };
}

export function freeSeatPlan({
  includedSeats,
  inUse,
  held = noHeldSeats,
  invites,
  price,
}: FreeSeatPlan) {
  const total = inUse + invites;
  const over = total > includedSeats;
  const action = freeSeatAction({ invites, total, over, price });
  const summary: SeatSummaryLine[] = over
    ? [
        { label: "Plan", value: "Free → Growth" },
        {
          label: "Full seats",
          value: `${total} × ${money(price, price.seatCents)}`,
          muted: true,
        },
        {
          label: "Monthly price",
          value: `${money(price, total * price.seatCents)}${price.periodSuffix}`,
          note: recurringNote(total * price.seatCents),
          ruled: true,
          emphasis: true,
        },
      ]
    : [
        { label: "Plan", value: "Free" },
        { label: "Seats", value: `${total} of ${includedSeats} included`, muted: true },
        { label: "Monthly price", value: money(price, 0), ruled: true, emphasis: true },
      ];
  return {
    heading: `Free includes ${includedSeats} seats. ${inUseLine({ inUse, held })}`,
    rowChip: over ? "Invited after payment" : "Invited now",
    note: over
      ? `${people(total)} is more than Free covers. Growth bills every full seat, ${total} × ${money(price, price.seatCents)}.`
      : undefined,
    summary,
    action,
  };
}

export type DeveloperSeatPlan = { current: number; target: number; unitCents: number };

export type GrowthSeatPlan = {
  /** The seats paid for now. */
  paid: number;
  /** The seats the drawer asks for. */
  seats: number;
  inUse: number;
  /** Of `inUse`, the seats held for people who left a full seat. */
  held?: HeldSeats;
  invites: number;
  price: SeatPrice;
  quote: SeatQuote | undefined;
  developer: DeveloperSeatPlan | undefined;
  developerDueCents: number | undefined;
  /** Of `developerDueCents`, the VAT; absent when none is charged. */
  developerTaxCents?: number;
  /** When the period already paid for ends, epoch milliseconds. */
  periodEndsAt: number | undefined;
};

/** The seats the drawer may not go under: everyone who holds or is invited to a full seat. */
export function growthMinimumSeats({ inUse, invites }: { inUse: number; invites: number }) {
  return Math.max(1, inUse + invites);
}

export function growthSeatPlan(plan: GrowthSeatPlan) {
  const { paid, seats, inUse, held = noHeldSeats, invites, price, quote, developer } = plan;
  const delta = seats - paid;
  const devDelta = developer ? developer.target - developer.current : 0;
  const day = nextPeriodDay(plan);
  const monthly =
    seats * price.seatCents + (developer ? developer.target * developer.unitCents : 0);
  return {
    heading: `You pay for ${paid}. ${inUseLine({ inUse, held })}`,
    rowChip: "Invited when you confirm",
    minimumHint:
      seats <= growthMinimumSeats({ inUse, invites }) && seats < paid
        ? growthMinimumHint({ inUse, held })
        : undefined,
    note: growthNote({ delta, paid, seats, quote, day }),
    summary: growthSummary({ ...plan, delta, devDelta, day, monthly }),
    action: growthAction({ delta, devDelta, seats, invites, price, developer }),
  };
}

function growthMinimumHint({ inUse, held }: { inUse: number; held: HeldSeats }): string {
  const lower = "Remove someone in Users to go lower.";
  if (!("firstFreesOn" in held)) return `${peopleUse(inUse)} full seats. ${lower}`;
  const heldPart =
    held.count === 1
      ? `1 more is held until ${held.firstFreesOn}`
      : `${held.count} more are held, the first until ${held.firstFreesOn}`;
  return `${peopleUse(inUse - held.count)} full seats and ${heldPart}. ${lower}`;
}

function nextPeriodDay({
  quote,
  periodEndsAt,
}: Pick<GrowthSeatPlan, "quote" | "periodEndsAt">): string | undefined {
  return billingDayOrUndefined(quote?.appliesAt ?? periodEndsAt);
}

function growthNote({
  delta,
  paid,
  seats,
  quote,
  day,
}: {
  delta: number;
  paid: number;
  seats: number;
  quote: SeatQuote | undefined;
  day: string | undefined;
}): string | undefined {
  if (delta < 0 && day) {
    const kept = quote?.keptSeats ?? paid;
    const rest = quote?.billingInterval === "year" ? "year" : "month";
    return `You'll keep ${kept} seats until ${day}, then pay for ${seats}. No refund for the rest of this ${rest}.`;
  }
  if (delta > 0 && quote?.appliesAt != null && day) {
    return `Nothing to pay today: you keep ${quote.keptSeats ?? paid} seats until ${day}, then pay for ${seats}.`;
  }
  if (delta > 0 && day) {
    return `Added to your subscription now, prorated to ${day}. No new checkout.`;
  }
  return undefined;
}

function growthSummary({
  paid,
  seats,
  inUse,
  price,
  quote,
  developer,
  developerDueCents,
  developerTaxCents,
  delta,
  devDelta,
  day,
  monthly,
}: GrowthSeatPlan & { delta: number; devDelta: number; day: string | undefined; monthly: number }) {
  const perPeriod = (cents: number) => `${money(price, cents)}${price.periodSuffix}`;
  const keptCents = paid * price.seatCents;
  const devLine: SeatSummaryLine[] =
    developer && developer.target > 0
      ? [
          {
            label: "Developer seats",
            value: `${developer.target} × ${money(price, developer.unitCents)}`,
            muted: true,
          },
        ]
      : [];
  if (delta < 0) {
    return [
      { label: "Full seats", value: `${paid} → ${seats}`, muted: true },
      ...devLine,
      {
        label: day ? `Until ${day}` : "Until the period ends",
        value: quote?.formattedKeptRecurringTotal
          ? `${quote.formattedKeptRecurringTotal}${price.periodSuffix}`
          : perPeriod(keptCents),
        note: recurringNote(keptCents),
        muted: true,
      },
      {
        label: day ? `From ${day}` : "From the next period",
        value: perPeriod(monthly),
        note: recurringNote(monthly),
        ruled: true,
        emphasis: true,
      },
    ];
  }
  if (delta > 0 || devDelta > 0) {
    const due = dueTodayCents({ delta, quote, devDelta, developerDueCents });
    const taxCents = dueTodayTaxCents({ delta, quote, devDelta, developerTaxCents });
    const seatsValue = delta > 0 ? `${paid} → ${seats}` : `${seats}, ${inUse} in use`;
    return addingSummary({ seatsValue, devLine, due, taxCents, day, monthly, price });
  }
  return [
    { label: "Full seats", value: `${seats}, ${inUse} in use`, muted: true },
    ...devLine,
    {
      label: "Monthly price",
      value: perPeriod(monthly),
      note: recurringNote(monthly),
      ruled: true,
      emphasis: true,
    },
  ];
}

function addingSummary({
  seatsValue,
  devLine,
  due,
  taxCents,
  day,
  monthly,
  price,
}: {
  seatsValue: string;
  devLine: SeatSummaryLine[];
  due: number | undefined;
  taxCents: number;
  day: string | undefined;
  monthly: number;
  price: SeatPrice;
}): SeatSummaryLine[] {
  return [
    { label: "Full seats", value: seatsValue, muted: true },
    ...devLine,
    {
      label: "Due today, prorated",
      value: due === undefined ? "…" : money(price, due),
      note: vatSplit({ price, dueCents: due, taxCents }),
    },
    {
      label: day ? `Then from ${day}` : "Then each period",
      value: `${money(price, monthly)}${price.periodSuffix}`,
      note: recurringNote(monthly),
      ruled: true,
      emphasis: true,
    },
  ];
}

/** Charged now for the change; undefined while a price it needs has not loaded. */
export function dueTodayCents({
  delta,
  quote,
  devDelta,
  developerDueCents,
}: {
  delta: number;
  quote: SeatQuote | undefined;
  devDelta: number;
  developerDueCents: number | undefined;
}): number | undefined {
  const seatsDue = delta > 0 ? quote?.amountDueCents : 0;
  const devDue = devDelta > 0 ? developerDueCents : 0;
  if (seatsDue === undefined || devDue === undefined) return undefined;
  return Math.max(0, seatsDue) + Math.max(0, devDue);
}

/** The VAT inside `dueTodayCents`; zero while none is charged or a quote has not loaded. */
export function dueTodayTaxCents({
  delta,
  quote,
  devDelta,
  developerTaxCents,
}: {
  delta: number;
  quote: SeatQuote | undefined;
  devDelta: number;
  developerTaxCents: number | undefined;
}): number {
  const seatsTax = delta > 0 ? (quote?.taxCents ?? 0) : 0;
  const devTax = devDelta > 0 ? (developerTaxCents ?? 0) : 0;
  return Math.max(0, seatsTax) + Math.max(0, devTax);
}

function growthAction({
  delta,
  devDelta,
  seats,
  invites,
  price,
  developer,
}: {
  delta: number;
  devDelta: number;
  seats: number;
  invites: number;
  price: SeatPrice;
  developer: DeveloperSeatPlan | undefined;
}): SeatAction {
  const per = (cents: number) => `${money(price, cents)}${price.periodSuffix}`;
  if (delta !== 0 && devDelta !== 0) return { kind: "change", label: "Confirm seat changes" };
  if (delta > 0) {
    return {
      kind: "change",
      label: `Add ${plural(delta, "seat")} · ${per(delta * price.seatCents)}`,
    };
  }
  if (delta < 0) return { kind: "change", label: `Lower to ${plural(seats, "seat")}` };
  if (devDelta > 0 && developer) {
    return {
      kind: "change",
      label: `Add ${plural(devDelta, "developer seat")} · ${per(devDelta * developer.unitCents)}`,
    };
  }
  if (devDelta < 0 && developer) {
    return { kind: "change", label: `Lower to ${plural(developer.target, "developer seat")}` };
  }
  if (invites > 0) return { kind: "invite", label: `Invite ${people(invites)}` };
  return { kind: "none", label: "No changes" };
}

/** A line of the confirm dialog: what, when, and how much. */
export type ConfirmLine = {
  label: string;
  detail: string;
  value: string;
  /** Quiet words under the value: "excl. VAT", or how a charge splits into price and VAT. */
  note?: string;
};

export type SeatConfirm = {
  title: string;
  lines: ConfirmLine[];
  body: string | undefined;
  actionLabel: string;
};

/** What every confirm line needs: the seats asked for, priced per period. */
type ConfirmPricing = {
  day: string | undefined;
  fromDay: string;
  perPeriod: (cents: number) => string;
  seatsDetail: (n: number) => string;
  monthly: (n: number) => number;
};

function confirmPricing(plan: GrowthSeatPlan): ConfirmPricing {
  const { price, developer } = plan;
  const day = nextPeriodDay(plan);
  const devTarget = developer?.target ?? 0;
  const devUnit = developer?.unitCents ?? 0;
  const devDetail = devTarget > 0 ? ` + ${devTarget} developer × ${money(price, devUnit)}` : "";
  return {
    day,
    fromDay: day ? `From ${day}` : "From the next period",
    perPeriod: (cents) => `${money(price, cents)}${price.periodSuffix}`,
    seatsDetail: (n) => `${plural(n, "seat")} × ${money(price, price.seatCents)}${devDetail}`,
    monthly: (n) => n * price.seatCents + devTarget * devUnit,
  };
}

function loweringConfirm({
  plan,
  pricing,
  devDelta,
  todayMs,
}: {
  plan: GrowthSeatPlan;
  pricing: ConfirmPricing;
  devDelta: number;
  todayMs: number;
}): SeatConfirm {
  const { paid, seats, price, quote } = plan;
  const { day, fromDay, perPeriod, seatsDetail, monthly } = pricing;
  const due =
    devDelta > 0
      ? dueTodayCents({ delta: 0, quote, devDelta, developerDueCents: plan.developerDueCents })
      : undefined;
  const taxCents = dueTodayTaxCents({
    delta: 0,
    quote,
    devDelta,
    developerTaxCents: plan.developerTaxCents,
  });
  const kept = quote?.keptSeats ?? paid;
  const rest = quote?.billingInterval === "year" ? "year" : "month";
  const until = day ? `until ${day}` : "until the period ends";
  return {
    title: `Lower to ${plural(seats, "seat")}${day ? ` from ${day}` : ""}?`,
    lines: [
      ...todayLine({ due, taxCents, price, todayMs, day }),
      {
        label: day ? `Until ${day}` : "Until the period ends",
        detail: `${plural(kept, "seat")} × ${money(price, price.seatCents)}`,
        value: perPeriod(kept * price.seatCents),
        note: recurringNote(kept * price.seatCents),
      },
      {
        label: fromDay,
        detail: seatsDetail(seats),
        value: perPeriod(monthly(seats)),
        note: recurringNote(monthly(seats)),
      },
    ],
    body: `You keep ${kept} seats ${until}. From then you pay ${perPeriod(monthly(seats))} for ${seats}. No refund for the rest of this ${rest}.`,
    actionLabel: `Lower to ${plural(seats, "seat")}`,
  };
}

function todayLine({
  due,
  taxCents,
  price,
  todayMs,
  day,
}: {
  due: number | undefined;
  taxCents: number;
  price: SeatPrice;
  todayMs: number;
  day: string | undefined;
}): ConfirmLine[] {
  if (due === undefined) return [];
  if (due === 0) {
    return [{ label: "Today", detail: "Nothing to pay today.", value: money(price, 0) }];
  }
  const period = `${billingDay(todayMs)}${day ? ` to ${day}` : ""}`;
  return [
    {
      label: "Today",
      detail: `Charged today to the card on file, for ${period}.`,
      value: money(price, due),
      note: vatSplit({ price, dueCents: due, taxCents }),
    },
  ];
}

function inviteBody({ emails, delta }: { emails: string[]; delta: number }) {
  if (emails.length === 0) return undefined;
  const gets = emails.length === 1 ? "gets the invite" : "get their invites";
  const added = delta === 1 ? "seat is" : "seats are";
  return `${joinEmails(emails)} ${gets} as soon as the ${added} added.`;
}

/** The confirm a Growth seat change asks before the provider is touched. */
export function seatConfirm({
  plan,
  emails,
  todayMs,
}: {
  plan: GrowthSeatPlan;
  emails: string[];
  todayMs: number;
}): SeatConfirm {
  const { paid, seats, price, developer, quote } = plan;
  const delta = seats - paid;
  const devDelta = developer ? developer.target - developer.current : 0;
  const pricing = confirmPricing(plan);
  if (delta < 0) return loweringConfirm({ plan, pricing, devDelta, todayMs });

  const due = dueTodayCents({ delta, quote, devDelta, developerDueCents: plan.developerDueCents });
  const taxCents = dueTodayTaxCents({
    delta,
    quote,
    devDelta,
    developerTaxCents: plan.developerTaxCents,
  });
  const added = delta > 0 ? plural(delta, "seat") : plural(Math.max(devDelta, 0), "developer seat");
  const charged = due !== undefined && due > 0;
  return {
    title:
      delta !== 0 || devDelta > 0
        ? `Add ${added} to your organization?`
        : "Change your developer seats?",
    lines: [
      ...todayLine({ due, taxCents, price, todayMs, day: pricing.day }),
      {
        label: pricing.fromDay,
        detail: pricing.seatsDetail(seats),
        value: pricing.perPeriod(pricing.monthly(seats)),
        note: recurringNote(pricing.monthly(seats)),
      },
    ],
    body: inviteBody({ emails, delta }),
    actionLabel: charged ? `Pay ${money(price, due)} and add` : "Confirm",
  };
}

export function joinEmails(emails: string[]): string {
  if (emails.length <= 1) return emails[0] ?? "";
  return `${emails.slice(0, -1).join(", ")} and ${emails[emails.length - 1]}`;
}

/** The toast after a confirmed change. */
export function seatChangeToast({
  paid,
  seats,
  emails,
  day,
  developer,
}: {
  paid: number;
  seats: number;
  emails: string[];
  day: string | undefined;
  developer?: { current: number; target: number };
}): string {
  const from = day ? `From ${day}` : "From the next period";
  const dev = developer && developer.target !== developer.current ? developer : undefined;
  const devSeats = dev ? plural(dev.target, "developer seat") : "";
  const devLater = dev && dev.target < dev.current ? `${from} you pay for ${devSeats}.` : "";
  const devNow = dev && dev.target > dev.current ? devSeats : "";
  const invites =
    emails.length === 0
      ? ""
      : ` ${emails.length === 1 ? "Invite" : "Invites"} sent to ${joinEmails(emails)}.`;
  const text = [fullSeatsLine({ paid, seats, from, devNow }), devLater].filter(Boolean).join(" ");
  return (text || "Seats updated.") + invites;
}

/** The full-seat sentence of the toast, carrying Developer seats added now when there are any. */
function fullSeatsLine({
  paid,
  seats,
  from,
  devNow,
}: {
  paid: number;
  seats: number;
  from: string;
  devNow: string;
}): string {
  const now = devNow ? ` You now pay for ${devNow}.` : "";
  if (seats < paid) return `${from} you pay for ${plural(seats, "seat")}.${now}`;
  if (seats === paid) return devNow ? `You now pay for ${devNow}.` : "";
  const delta = seats - paid;
  const added = delta === 1 ? "Seat" : `${delta} seats`;
  const also = devNow ? ` and ${devNow}` : "";
  return `${added} added. You now pay for ${plural(seats, "seat")}${also}.`;
}
