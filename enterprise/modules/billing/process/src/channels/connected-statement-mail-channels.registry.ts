// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { MemoryConnectedStatementMailChannel } from "./memory/memory.connected-statement-mail.channel.ts";
import { SesConnectedStatementMailChannel } from "./ses/ses.connected-statement-mail.channel.ts";

export const connectedStatementMailChannels = {
  ses: SesConnectedStatementMailChannel,
  memory: MemoryConnectedStatementMailChannel,
};
