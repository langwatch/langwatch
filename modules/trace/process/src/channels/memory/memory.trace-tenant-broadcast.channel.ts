import {
  TraceTenantBroadcast,
  type TraceTenantBroadcastMessage,
} from "../trace-tenant-broadcast.channel.ts";

/** The tenant fan-out with no Redis behind it: every publish is kept for the caller to read. */
export class MemoryTraceTenantBroadcastChannel extends TraceTenantBroadcast {
  static create(): MemoryTraceTenantBroadcastChannel {
    return new MemoryTraceTenantBroadcastChannel();
  }

  readonly published: TraceTenantBroadcastMessage[] = [];

  private constructor() {
    super();
  }

  async broadcastToTenant(input: TraceTenantBroadcastMessage): Promise<void> {
    this.published.push(input);
  }
}
