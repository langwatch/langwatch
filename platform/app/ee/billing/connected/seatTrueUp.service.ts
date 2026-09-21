/**
 * The quarterly seat true-up of a connected self-hosted customer (ADR-141,
 * section 7).
 *
 * A connected install reports its seats once a day and the registry keeps the
 * highest count of each term quarter. When a quarter closes, the seats above
 * what the customer has already been invoiced for are billed on their own
 * one-off invoice, prorated over the days of the term that are still to run.
 *
 * Two rules shape the code more than anything else. The first is that seats
 * are never credited back mid-term: a quarter whose peak is lower than the
 * seats already invoiced owes nothing and creates nothing. The second is that
 * a quarter is decided once: the decision row is written before the payment
 * provider is called and completed after it, and the call carries a key
 * derived from the license and the quarter, so a run that failed halfway
 * invoices the same seats once.
 *
 * Nothing here reads a database, the environment or the clock directly.
 */

import { createLogger } from "@langwatch/observability";
import { licenseTermQuarterStartAt } from "../../licensing/registry/seatReports";
import type {
  BankTransfer,
  ConnectedCurrency,
} from "./connectedBilling.service";

const logger = createLogger("langwatch:billing:connectedSeatTrueUp");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The currencies a seat contract is written in. */
export type SeatCurrency = ConnectedCurrency;

/** How the true-up of one license quarter ended. */
export type SeatTrueUpState =
  | "intent"
  | "invoiced"
  | "nothing_to_invoice"
  | "flagged"
  | "skipped";

/** One license the true-up walks. */
export interface SeatTrueUpLicense {
  /** The `IssuedLicense` row id. */
  id: string;
  organizationId: string;
  issuedAt: Date;
  /** Seats the license itself is written for. */
  maxMembers: number;
  /** Seats the install may go over `maxMembers` by. Zero means none. */
  seatOverageAllowance: number;
  /** When the install last synced, null when it never has. */
  lastSyncAt: Date | null;
}

/** The commercial terms a seat invoice is written against. */
export interface SeatTrueUpAccount {
  id: string;
  stripeCustomerId: string;
  seatCurrency: SeatCurrency;
  /** The annual rate of one seat, in cents of `seatCurrency`. */
  seatRateCents: number;
  /** Seats invoiced up front, on the annual invoice at the start of the term. */
  seats: number;
  termStartsAt: Date;
  termEndsAt: Date;
  /** How the customer pays, when it pays into a virtual bank account. */
  bankTransfer: BankTransfer | null;
}

/** The highest seat count one license reported in one quarter. */
export interface SeatQuarterPeak {
  peakMembers: number;
  lastReportedAt: Date;
}

/** What the true-up decided for one license quarter. */
export interface SeatTrueUpRecord {
  licenseId: string;
  quarterStartsAt: Date;
  peakSeats: number;
  addedSeats: number;
  amountCents: number;
  currency: SeatCurrency;
  state: SeatTrueUpState;
  stripeInvoiceId: string | null;
}

export interface SeatTrueUpStore {
  /** Every license of a customer that could be invoiced for added seats. */
  listLicenses(): Promise<SeatTrueUpLicense[]>;
  /** The billing account of a customer, null when it was never onboarded. */
  findAccount(organizationId: string): Promise<SeatTrueUpAccount | null>;
  findPeak(key: {
    licenseId: string;
    quarterStartsAt: Date;
  }): Promise<SeatQuarterPeak | null>;
  /** Every decision already taken for this license, in any state. */
  findDecisions(licenseId: string): Promise<SeatTrueUpRecord[]>;
  /** Writes the decision for one quarter, replacing an earlier state of it. */
  record(record: SeatTrueUpRecord): Promise<void>;
}

export interface SeatTrueUpInvoicer {
  /**
   * A one-off invoice for the added seats, finalized and sent. It carries no
   * subscription, which is what keeps the usage commit out of it: a credit
   * grant applies to metered subscription items and to nothing else.
   */
  invoiceAddedSeats(input: {
    /** The `ConnectedBillingAccount` the invoice is recorded against. */
    accountId: string;
    /** The quarter the invoice settles. */
    quarterStartsAt: Date;
    stripeCustomerId: string;
    bankTransfer: BankTransfer | null;
    currency: SeatCurrency;
    /** What one added seat costs for the rest of the term. */
    unitAmountCents: number;
    /** Seats on the line, and the quantity the customer reads. */
    addedSeats: number;
    /** `unitAmountCents` times `addedSeats`. */
    amountCents: number;
    description: string;
    idempotencyKey: string;
  }): Promise<{ invoiceId: string }>;
}

export interface ConnectedSeatTrueUpDeps {
  store: SeatTrueUpStore;
  invoicer: SeatTrueUpInvoicer;
  now: () => Date;
}

/** What one run decided, counted by outcome. */
export interface SeatTrueUpRunSummary {
  quartersConsidered: number;
  invoiced: number;
  nothingToInvoice: number;
  flagged: number;
  skipped: number;
  failed: number;
}

/** Whole days from `from` to `to`, floored, negative when `to` comes first. */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * What one added seat costs for the rest of the term, in cents.
 *
 * Only the part of the term that is still to run is charged, counted from the
 * day after the quarter closed, so nothing is backdated to days the seats were
 * already in use. The rate is rounded to the cent per seat, because that is
 * the unit amount the invoice line carries: a customer reading the line
 * multiplies the unit by the quantity and gets the total back.
 */
export function proratedSeatUnitAmountCents({
  seatRateCents,
  daysRemaining,
  termDays,
}: {
  seatRateCents: number;
  daysRemaining: number;
  termDays: number;
}): number {
  if (daysRemaining <= 0 || termDays <= 0) return 0;
  return Math.round((seatRateCents * daysRemaining) / termDays);
}

/** The whole line for the seats added in a quarter that has closed. */
export function proratedSeatAmountCents({
  addedSeats,
  seatRateCents,
  daysRemaining,
  termDays,
}: {
  addedSeats: number;
  seatRateCents: number;
  daysRemaining: number;
  termDays: number;
}): number {
  if (addedSeats <= 0) return 0;
  return (
    proratedSeatUnitAmountCents({ seatRateCents, daysRemaining, termDays }) *
    addedSeats
  );
}

/** One term quarter, as the true-up walks it. */
export interface TermQuarter {
  startsAt: Date;
  endsAt: Date;
}

/**
 * The term quarters of a license that have closed by `now` and start inside
 * the term, oldest first. The quarter `now` falls in is not one of them.
 */
export function closedTermQuarters({
  issuedAt,
  termEndsAt,
  now,
}: {
  issuedAt: Date;
  termEndsAt: Date;
  now: Date;
}): TermQuarter[] {
  const quarters: TermQuarter[] = [];
  for (let index = 0; ; index += 1) {
    const startsAt = licenseTermQuarterStartAt({ issuedAt, index });
    if (startsAt >= termEndsAt) break;
    const endsAt = licenseTermQuarterStartAt({ issuedAt, index: index + 1 });
    if (endsAt > now) break;
    quarters.push({ startsAt, endsAt });
  }
  return quarters;
}

/** The key one quarter's invoice is created under, on every attempt. */
export function seatTrueUpIdempotencyKey({
  licenseId,
  quarterStartsAt,
}: {
  licenseId: string;
  quarterStartsAt: Date;
}): string {
  return `connected-seat-true-up:${licenseId}:${quarterStartsAt.toISOString()}`;
}

/** The line a customer reads on the invoice. */
function seatInvoiceDescription({
  addedSeats,
  quarterStartsAt,
  daysRemaining,
  termDays,
}: {
  addedSeats: number;
  quarterStartsAt: Date;
  daysRemaining: number;
  termDays: number;
}): string {
  const quarter = quarterStartsAt.toISOString().slice(0, 10);
  const seats = addedSeats === 1 ? "seat" : "seats";
  return (
    `${addedSeats} ${seats} added in the quarter starting ${quarter}, ` +
    `charged for the ${daysRemaining} days of the ${termDays} day term that remain`
  );
}

const DONE_STATES = new Set<SeatTrueUpState>([
  "invoiced",
  "nothing_to_invoice",
  "skipped",
]);

/**
 * States that mean the seats they name are committed to an invoice, so a
 * later quarter must not invoice them again. `intent` counts: the invoice may
 * already exist at the payment provider, and the retry that completes it
 * carries the same key.
 */
const COMMITTED_STATES = new Set<SeatTrueUpState>(["invoiced", "intent"]);

export class ConnectedSeatTrueUpService {
  constructor(private readonly deps: ConnectedSeatTrueUpDeps) {}

  /** One tick: every license, every quarter of its term that has closed. */
  async run(): Promise<SeatTrueUpRunSummary> {
    const summary: SeatTrueUpRunSummary = {
      quartersConsidered: 0,
      invoiced: 0,
      nothingToInvoice: 0,
      flagged: 0,
      skipped: 0,
      failed: 0,
    };

    for (const license of await this.deps.store.listLicenses()) {
      try {
        await this.runForLicense({ license, summary });
      } catch (error) {
        summary.failed += 1;
        logger.error(
          { licenseId: license.id, error },
          "seat true-up failed for one license, continuing with the rest",
        );
      }
    }

    return summary;
  }

  private async runForLicense({
    license,
    summary,
  }: {
    license: SeatTrueUpLicense;
    summary: SeatTrueUpRunSummary;
  }): Promise<void> {
    const account = await this.deps.store.findAccount(license.organizationId);
    if (!account) return;

    const quarters = closedTermQuarters({
      issuedAt: license.issuedAt,
      termEndsAt: account.termEndsAt,
      now: this.deps.now(),
    });
    if (quarters.length === 0) return;

    const decisions = await this.deps.store.findDecisions(license.id);
    const byQuarter = new Map(
      decisions.map((decision) => [
        decision.quarterStartsAt.getTime(),
        decision,
      ]),
    );

    for (const quarter of quarters) {
      const taken = byQuarter.get(quarter.startsAt.getTime());
      if (taken && DONE_STATES.has(taken.state)) continue;

      summary.quartersConsidered += 1;
      const decided = await this.decideQuarter({
        license,
        account,
        quarter,
        committedSeats: this.committedSeatsBefore({
          account,
          decisions: [...byQuarter.values()],
          quarterStartsAt: quarter.startsAt,
        }),
      });
      byQuarter.set(quarter.startsAt.getTime(), decided);
      countOutcome(summary, decided.state);
    }
  }

  /** Seats already committed to an invoice before this quarter. */
  private committedSeatsBefore({
    account,
    decisions,
    quarterStartsAt,
  }: {
    account: SeatTrueUpAccount;
    decisions: SeatTrueUpRecord[];
    quarterStartsAt: Date;
  }): number {
    return decisions
      .filter(
        (decision) =>
          decision.quarterStartsAt < quarterStartsAt &&
          COMMITTED_STATES.has(decision.state),
      )
      .reduce((total, decision) => total + decision.addedSeats, account.seats);
  }

  private async decideQuarter({
    license,
    account,
    quarter,
    committedSeats,
  }: {
    license: SeatTrueUpLicense;
    account: SeatTrueUpAccount;
    quarter: TermQuarter;
    committedSeats: number;
  }): Promise<SeatTrueUpRecord> {
    const quarterStartsAt = quarter.startsAt;
    const peak = await this.deps.store.findPeak({
      licenseId: license.id,
      quarterStartsAt,
    });

    if (!peak) {
      return await this.recordUnreported({
        license,
        account,
        quarterStartsAt,
      });
    }

    const addedSeats = peak.peakMembers - committedSeats;
    const daysRemaining = daysBetween(quarter.endsAt, account.termEndsAt);
    const termDays = daysBetween(account.termStartsAt, account.termEndsAt);
    const unitAmountCents = proratedSeatUnitAmountCents({
      seatRateCents: account.seatRateCents,
      daysRemaining,
      termDays,
    });
    const amountCents = addedSeats > 0 ? unitAmountCents * addedSeats : 0;

    const base: SeatTrueUpRecord = {
      licenseId: license.id,
      quarterStartsAt,
      peakSeats: peak.peakMembers,
      addedSeats: Math.max(0, addedSeats),
      amountCents,
      currency: account.seatCurrency,
      state: "nothing_to_invoice",
      stripeInvoiceId: null,
    };

    if (amountCents <= 0) {
      await this.deps.store.record(base);
      return base;
    }

    const intent: SeatTrueUpRecord = { ...base, state: "intent" };
    await this.deps.store.record(intent);

    const { invoiceId } = await this.deps.invoicer.invoiceAddedSeats({
      accountId: account.id,
      quarterStartsAt,
      stripeCustomerId: account.stripeCustomerId,
      bankTransfer: account.bankTransfer,
      currency: account.seatCurrency,
      unitAmountCents,
      addedSeats,
      amountCents,
      description: seatInvoiceDescription({
        addedSeats,
        quarterStartsAt,
        daysRemaining,
        termDays,
      }),
      idempotencyKey: seatTrueUpIdempotencyKey({
        licenseId: license.id,
        quarterStartsAt,
      }),
    });

    const invoiced: SeatTrueUpRecord = {
      ...intent,
      state: "invoiced",
      stripeInvoiceId: invoiceId,
    };
    await this.deps.store.record(invoiced);
    return invoiced;
  }

  /**
   * A quarter the install reported nothing in. The peak is not known, so
   * nothing is invoiced on a guess: a license that can go over its seats is
   * flagged for an operator, and one that cannot is left to the annual
   * true-up.
   */
  private async recordUnreported({
    license,
    account,
    quarterStartsAt,
  }: {
    license: SeatTrueUpLicense;
    account: SeatTrueUpAccount;
    quarterStartsAt: Date;
  }): Promise<SeatTrueUpRecord> {
    const airGapped =
      license.seatOverageAllowance <= 0 && license.lastSyncAt === null;
    const record: SeatTrueUpRecord = {
      licenseId: license.id,
      quarterStartsAt,
      peakSeats: 0,
      addedSeats: 0,
      amountCents: 0,
      currency: account.seatCurrency,
      state: airGapped ? "skipped" : "flagged",
      stripeInvoiceId: null,
    };
    await this.deps.store.record(record);
    return record;
  }
}

function countOutcome(
  summary: SeatTrueUpRunSummary,
  state: SeatTrueUpState,
): void {
  if (state === "invoiced") summary.invoiced += 1;
  if (state === "nothing_to_invoice") summary.nothingToInvoice += 1;
  if (state === "flagged") summary.flagged += 1;
  if (state === "skipped") summary.skipped += 1;
}
