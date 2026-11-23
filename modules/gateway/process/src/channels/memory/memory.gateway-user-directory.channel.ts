import type { GatewayUserDirectoryChannel } from "../gateway-user-directory.channel.ts";

/** Accounts in memory: each exists until a test erases it, or every lookup fails once it breaks. */
export class MemoryGatewayUserDirectoryChannel implements GatewayUserDirectoryChannel {
  readonly asked: string[] = [];
  private readonly erased = new Set<string>();
  private outage: Error | null = null;

  private constructor() {}

  static create(): MemoryGatewayUserDirectoryChannel {
    return new MemoryGatewayUserDirectoryChannel();
  }

  erase({ userId }: { userId: string }): void {
    this.erased.add(userId);
  }

  /** Every later lookup throws `error`, as an unreachable user module would. */
  failWith({ error }: { error: Error }): void {
    this.outage = error;
  }

  async accountExists({ userId }: { userId: string }): Promise<boolean> {
    this.asked.push(userId);
    if (this.outage) throw this.outage;
    return !this.erased.has(userId);
  }
}
