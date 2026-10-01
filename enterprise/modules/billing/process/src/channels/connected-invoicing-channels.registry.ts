// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HttpConnectedInvoicingChannel } from "./http/http.connected-invoicing.channel.ts";
import { MemoryConnectedInvoicingChannel } from "./memory/memory.connected-invoicing.channel.ts";

export const connectedInvoicingChannels = {
  http: HttpConnectedInvoicingChannel,
  memory: MemoryConnectedInvoicingChannel,
};
