/**
 * Sends the monthly statement of a connected self-hosted customer.
 *
 * It lives beside the template rather than next to the service that builds the
 * statement, because rendering it pulls in react-email and backend code must
 * not reach a browser-only package outside `src/server/mailer`.
 */

import type {
  ConnectedStatement,
  MonthlyStatementMailer,
} from "../../../ee/billing/connected/monthlyStatement.service";
import { sendConnectedStatementEmail } from "./connectedStatementEmail";

/** The month as the statement names it, such as "August 2026". */
export function statementMonthLabel(month: Date): string {
  return month.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export class EmailMonthlyStatementMailer implements MonthlyStatementMailer {
  async send(statement: ConnectedStatement): Promise<void> {
    await sendConnectedStatementEmail({
      to: statement.to,
      organizationName: statement.organizationName,
      monthLabel: statementMonthLabel(statement.month),
      spendByService: statement.spendByService,
      totalUsdCents: statement.totalUsdCents,
      commitUsdCents: statement.commitUsdCents,
      commitDrawnDownUsdCents: statement.commitDrawnDownUsdCents,
      creditRemainingUsdCents: statement.creditRemainingUsdCents,
      seatsLicensed: statement.seats.licensed,
      seatsReported: statement.seats.reported,
    });
  }
}
