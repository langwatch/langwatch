/**
 * The monthly usage statement of a connected self-hosted customer (ADR-141,
 * section 7).
 *
 * A connected customer is invoiced quarterly, so a month can pass with nothing
 * to read. The statement is what closes that gap: once a month the billing
 * contact gets what was spent by service, how much of the prepaid commit is
 * gone, what is left of it, and the seats the license covers next to the seats
 * the install reported.
 *
 * A month with no usage sends nothing, so an idle customer is not mailed
 * twelve times for nothing, and the send is recorded so a second tick in the
 * same month sends nothing either.
 *
 * Nothing here reads a database, the environment or the clock directly.
 */

import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:billing:connectedStatement");

/** One connected customer the statement covers. */
export interface StatementAccount {
  id: string;
  organizationId: string;
  organizationName: string;
  billingEmail: string;
  /** The prepaid commit of the current term, in USD cents. */
  commitUsdCents: number;
}

/** What one hosted service cost in the month, in USD cents. */
export interface StatementSpendLine {
  /** The service as the license names it, such as `instant_evals`. */
  service: string;
  usdCents: number;
}

/** Seats the license covers, next to the seats the install last reported. */
export interface StatementSeats {
  licensed: number;
  /** Null when the install has never synced. */
  reported: number | null;
}

/** The statement one customer is sent for one month. */
export interface ConnectedStatement {
  accountId: string;
  to: string;
  organizationName: string;
  month: Date;
  spendByService: StatementSpendLine[];
  totalUsdCents: number;
  commitUsdCents: number;
  /** Null when the spend ledger could not be read. */
  commitDrawnDownUsdCents: number | null;
  /** Null when the drawdown could not be read. */
  creditRemainingUsdCents: number | null;
  seats: StatementSeats;
}

export interface MonthlyStatementStore {
  listAccounts(): Promise<StatementAccount[]>;
  spendByService(input: {
    organizationId: string;
    month: Date;
  }): Promise<StatementSpendLine[]>;
  /** What the contract budget has drawn down, null when it cannot be read. */
  readDrawnDownUsdCents(organizationId: string): Promise<number | null>;
  readSeats(organizationId: string): Promise<StatementSeats>;
  hasSent(input: { accountId: string; month: Date }): Promise<boolean>;
  recordSent(input: {
    accountId: string;
    month: Date;
    sentAt: Date;
  }): Promise<void>;
}

export interface MonthlyStatementMailer {
  send(statement: ConnectedStatement): Promise<void>;
}

export interface ConnectedMonthlyStatementDeps {
  store: MonthlyStatementStore;
  mailer: MonthlyStatementMailer;
  now: () => Date;
}

/** What one run did, counted by outcome. */
export interface MonthlyStatementRunSummary {
  sent: number;
  alreadySent: number;
  noUsage: number;
  failed: number;
}

/** The first day, in UTC, of the month before the one `now` falls in. */
export function previousMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
}

export class ConnectedMonthlyStatementService {
  constructor(private readonly deps: ConnectedMonthlyStatementDeps) {}

  /** One tick: the month that has just ended, for every connected customer. */
  async run(): Promise<MonthlyStatementRunSummary> {
    const summary: MonthlyStatementRunSummary = {
      sent: 0,
      alreadySent: 0,
      noUsage: 0,
      failed: 0,
    };
    const month = previousMonthStart(this.deps.now());

    for (const account of await this.deps.store.listAccounts()) {
      try {
        await this.sendForAccount({ account, month, summary });
      } catch (error) {
        summary.failed += 1;
        logger.error(
          { accountId: account.id, error },
          "monthly statement failed for one customer, continuing with the rest",
        );
      }
    }

    return summary;
  }

  private async sendForAccount({
    account,
    month,
    summary,
  }: {
    account: StatementAccount;
    month: Date;
    summary: MonthlyStatementRunSummary;
  }): Promise<void> {
    if (await this.deps.store.hasSent({ accountId: account.id, month })) {
      summary.alreadySent += 1;
      return;
    }

    const spendByService = await this.deps.store.spendByService({
      organizationId: account.organizationId,
      month,
    });
    const totalUsdCents = spendByService.reduce(
      (total, line) => total + line.usdCents,
      0,
    );
    if (totalUsdCents <= 0) {
      // Nothing is recorded either: a month the customer sat idle should not
      // stop the statement of the month it comes back in.
      summary.noUsage += 1;
      return;
    }

    const commitDrawnDownUsdCents = await this.deps.store.readDrawnDownUsdCents(
      account.organizationId,
    );

    await this.deps.mailer.send({
      accountId: account.id,
      to: account.billingEmail,
      organizationName: account.organizationName,
      month,
      spendByService: spendByService.filter((line) => line.usdCents > 0),
      totalUsdCents,
      commitUsdCents: account.commitUsdCents,
      commitDrawnDownUsdCents,
      creditRemainingUsdCents:
        commitDrawnDownUsdCents === null
          ? null
          : Math.max(0, account.commitUsdCents - commitDrawnDownUsdCents),
      seats: await this.deps.store.readSeats(account.organizationId),
    });

    await this.deps.store.recordSent({
      accountId: account.id,
      month,
      sentAt: this.deps.now(),
    });
    summary.sent += 1;
  }
}
