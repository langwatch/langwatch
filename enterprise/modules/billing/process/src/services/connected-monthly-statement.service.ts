// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The monthly usage statement of a connected self-hosted customer (ADR-156
 * section 7): the quarterly invoice leaves months with nothing to read, so once
 * a month the billing contact gets the spend by service, the commit drawn down,
 * the credit left and the seats. An idle month sends nothing; a sent month is recorded.
 */

import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type { ConnectedStatementMailChannel } from "../channels/connected-statement-mail.channel.ts";
import type { ConnectedBillingRepository } from "../repositories/connected-billing.repository.ts";
import {
  creditRemainingUsdCents,
  nextMonthStart,
  previousMonthStart,
} from "../rules/connected-statement.rules.ts";

const logger = createLogger("langwatch:billing:connected-statement");

/** A connected customer, as the organization directory names it. */
export type ConnectedCustomer = { organizationId: string; organizationName: string };

/** What one hosted service cost in the month, in USD cents. */
export type StatementSpendLine = {
  /** The service as the license names it, such as `instant_evals`. */
  service: string;
  usdCents: number;
};

/** Seats the license covers, next to the seats the install last reported (null: never synced). */
export type StatementSeats = { licensed: number; reported: number | null };

/** What the contract budget has drawn down, or that the spend ledger could not say. */
export type CommitDrawdown = { kind: "read"; usdCents: number } | { kind: "unavailable" };

/** The statement one customer is sent for one month. */
export type ConnectedStatement = {
  accountId: string;
  to: string;
  organizationName: string;
  /** The first instant of the month covered, in UTC. */
  month: Instant;
  spendByService: StatementSpendLine[];
  totalUsdCents: number;
  commitUsdCents: number;
  /** Null when the spend ledger could not be read: unknown, never zero. */
  commitDrawnDownUsdCents: number | null;
  creditRemainingUsdCents: number | null;
  seats: StatementSeats;
};

/**
 * The facts a statement reads that billing does not own: the customers from the
 * organization directory, spend from the gateway ledger, the drawdown from the
 * contract budget and the seats from the license registry.
 */
export interface ConnectedStatementSources {
  findConnectedCustomers(): Promise<ConnectedCustomer[]>;
  findSpendByService(input: {
    organizationId: string;
    from: Instant;
    until: Instant;
  }): Promise<StatementSpendLine[]>;
  getCommitDrawdown(organizationId: string): Promise<CommitDrawdown>;
  getSeats(organizationId: string): Promise<StatementSeats>;
}

/** What one run did, counted by outcome. */
export type MonthlyStatementRunSummary = {
  sent: number;
  alreadySent: number;
  noUsage: number;
  failed: number;
};

export class ConnectedMonthlyStatementService {
  private constructor(
    private readonly repository: ConnectedBillingRepository,
    private readonly sources: ConnectedStatementSources,
    private readonly mail: ConnectedStatementMailChannel,
    private readonly now: () => Instant,
  ) {}

  static create(input: {
    repository: ConnectedBillingRepository;
    sources: ConnectedStatementSources;
    mail: ConnectedStatementMailChannel;
    now?: () => Instant;
  }): ConnectedMonthlyStatementService {
    return new ConnectedMonthlyStatementService(
      input.repository,
      input.sources,
      input.mail,
      input.now ?? nowInstant,
    );
  }

  /** One tick: the month that has just ended, for every connected customer. */
  async run(): Promise<MonthlyStatementRunSummary> {
    const summary: MonthlyStatementRunSummary = { sent: 0, alreadySent: 0, noUsage: 0, failed: 0 };
    const month = previousMonthStart(this.now());
    const customers = await this.sources.findConnectedCustomers();
    const names = new Map(customers.map((c) => [c.organizationId, c.organizationName]));
    const accounts = await this.repository.findAccountsForOrganizations(
      customers.map((c) => c.organizationId),
    );

    for (const account of accounts) {
      try {
        summary[
          await this.sendForAccount({
            account: { ...account, organizationName: names.get(account.organizationId) ?? "" },
            month,
          })
        ] += 1;
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
  }: {
    account: {
      id: string;
      organizationId: string;
      organizationName: string;
      billingEmail: string;
      commitUsdCents: number;
    };
    month: Instant;
  }): Promise<"sent" | "alreadySent" | "noUsage"> {
    if (await this.repository.hasSentStatement({ accountId: account.id, month })) {
      return "alreadySent";
    }

    const spend = await this.sources.findSpendByService({
      organizationId: account.organizationId,
      from: month,
      until: nextMonthStart(month),
    });
    const totalUsdCents = spend.reduce((total, line) => total + line.usdCents, 0);
    // Recording an idle month would keep the month it comes back in from sending.
    if (totalUsdCents <= 0) {
      return "noUsage";
    }

    const drawdown = await this.sources.getCommitDrawdown(account.organizationId);
    const drawnDownUsdCents = drawdown.kind === "read" ? drawdown.usdCents : null;

    await this.mail.send({
      accountId: account.id,
      to: account.billingEmail,
      organizationName: account.organizationName,
      month,
      spendByService: spend.filter((line) => line.usdCents > 0),
      totalUsdCents,
      commitUsdCents: account.commitUsdCents,
      commitDrawnDownUsdCents: drawnDownUsdCents,
      creditRemainingUsdCents:
        drawnDownUsdCents === null
          ? null
          : creditRemainingUsdCents({ commitUsdCents: account.commitUsdCents, drawnDownUsdCents }),
      seats: await this.sources.getSeats(account.organizationId),
    });
    await this.repository.recordStatementSent({
      accountId: account.id,
      month,
      sentAt: this.now(),
    });

    return "sent";
  }
}
