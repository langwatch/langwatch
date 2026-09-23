// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The daily billing tick of connected self-hosted customers (ADR-156 section 7):
 * the seat invoices whose payment call failed, the monthly statements, then the
 * renewals whose credit waited on the old term's last usage invoice. Each job
 * runs whatever the one before it did.
 */

import { createLogger } from "@langwatch/observability";

import type { ConnectedBillingRepository } from "../repositories/connected-billing.repository.ts";
import type { ConnectedBillingService } from "./connected-billing.service.ts";
import type { ConnectedCustomerFactsService } from "./connected-customer-facts.service.ts";
import type { ConnectedMonthlyStatementService } from "./connected-monthly-statement.service.ts";
import type { ConnectedSeatChangeService } from "./connected-seat-change.service.ts";

const logger = createLogger("langwatch:billing:connected-billing-tick");

/** What one tick drives, each only as wide as it is used. */
export type ConnectedBillingJobs = Readonly<{
  seats: Pick<ConnectedSeatChangeService, "completePendingSeatChanges">;
  /** Absent where no process composed the statement mail: nothing is sent or recorded. */
  statements: Pick<ConnectedMonthlyStatementService, "run"> | undefined;
  renewals: Pick<ConnectedBillingService, "completeRenewalIfDue">;
  repository: Pick<ConnectedBillingRepository, "findAccountsForOrganizations">;
  customers: Pick<ConnectedCustomerFactsService, "findConnectedCustomers">;
}>;

export class ConnectedBillingTickService {
  private constructor(private readonly jobs: ConnectedBillingJobs) {}

  static create(jobs: ConnectedBillingJobs): ConnectedBillingTickService {
    return new ConnectedBillingTickService(jobs);
  }

  async run(): Promise<void> {
    await this.runJob("seatChanges", () => this.jobs.seats.completePendingSeatChanges());
    await this.runJob("monthlyStatements", async () => {
      if (!this.jobs.statements) {
        logger.warn("no statement mail is composed in this process; monthly statements wait");
        return;
      }
      await this.jobs.statements.run();
    });
    await this.runJob("renewals", async () => {
      for (const organizationId of await this.pendingRenewalOrganizationIds()) {
        await this.jobs.renewals.completeRenewalIfDue({ organizationId });
      }
    });
  }

  /** Read from the customers an operator marked, one billing account each. */
  private async pendingRenewalOrganizationIds(): Promise<string[]> {
    const customers = await this.jobs.customers.findConnectedCustomers();
    const accounts = await this.jobs.repository.findAccountsForOrganizations(
      customers.map((customer) => customer.organizationId),
    );
    return accounts
      .filter((account) => account.pendingRenewal !== null)
      .map((account) => account.organizationId);
  }

  private async runJob(name: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      logger.error({ job: name, error }, "connected billing job failed");
    }
  }
}
