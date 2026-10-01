// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ConnectedStatement } from "../../services/connected-monthly-statement.service.ts";
import { ConnectedStatementMailChannel } from "../connected-statement-mail.channel.ts";

/** Keeps every statement handed over and sends nothing, where no mailer is composed. */
export class MemoryConnectedStatementMailChannel extends ConnectedStatementMailChannel {
  readonly sent: ConnectedStatement[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryConnectedStatementMailChannel {
    return new MemoryConnectedStatementMailChannel();
  }

  async send(statement: ConnectedStatement): Promise<void> {
    this.sent.push(statement);
  }
}
