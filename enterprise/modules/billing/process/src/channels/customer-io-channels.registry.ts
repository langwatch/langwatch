import { HttpCustomerIoChannel } from "./http/http.customer-io.channel.ts";
import { MemoryCustomerIoChannel } from "./memory/memory.customer-io.channel.ts";

export const customerIoChannels = {
  live: HttpCustomerIoChannel,
  memory: MemoryCustomerIoChannel,
};
