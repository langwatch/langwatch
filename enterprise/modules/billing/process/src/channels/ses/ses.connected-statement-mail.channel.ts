// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { sendConnectedStatementEmail, type EmailDelivery } from "@langwatch/mail";

import { statementMonthLabel } from "../../rules/connected-statement.rules.ts";
import type { ConnectedStatement } from "../../services/connected-monthly-statement.service.ts";
import { ConnectedStatementMailChannel } from "../connected-statement-mail.channel.ts";

/** Main's `EmailMonthlyStatementMailer` over the process's mail member. */
export class SesConnectedStatementMailChannel extends ConnectedStatementMailChannel {
  private constructor(private readonly mailer: EmailDelivery) {
    super();
  }

  static create(mailer: EmailDelivery): SesConnectedStatementMailChannel {
    return new SesConnectedStatementMailChannel(mailer);
  }

  send(statement: ConnectedStatement): Promise<void> {
    return sendConnectedStatementEmail({
      mailer: this.mailer,
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
