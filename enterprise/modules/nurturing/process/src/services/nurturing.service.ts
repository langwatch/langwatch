import type {
  CioBatchCall,
  CioEventName,
  CioOrgTraits,
  CioPersonTraits,
} from "@langwatch/enterprise-nurturing-contract";

import type { CustomerIoChannel } from "../channels/customer-io.channel.ts";

/** Nurturing's named Customer.io operations over the configured delivery channel. */
export class NurturingService {
  private constructor(private readonly channel: CustomerIoChannel) {}

  static create({ channel }: { channel: CustomerIoChannel }): NurturingService {
    return new NurturingService(channel);
  }

  async identifyUser({
    userId,
    traits,
  }: {
    userId: string;
    traits: Partial<CioPersonTraits>;
  }): Promise<void> {
    await this.channel.identifyUser({ userId, traits });
  }

  async trackEvent({
    userId,
    event,
    properties,
  }: {
    userId: string;
    event: CioEventName;
    properties?: Record<string, unknown>;
  }): Promise<void> {
    await this.channel.trackEvent({ userId, event, properties });
  }

  async groupUser({
    userId,
    groupId,
    traits,
  }: {
    userId: string;
    groupId: string;
    traits?: Partial<CioOrgTraits>;
  }): Promise<void> {
    await this.channel.groupUser({ userId, groupId, traits });
  }

  async batch(calls: CioBatchCall[]): Promise<void> {
    await this.channel.batch(calls);
  }
}
