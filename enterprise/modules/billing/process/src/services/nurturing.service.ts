import type {
  CioBatchCall,
  CioEventName,
  CioOrgTraits,
  CioPersonTraits,
} from "@langwatch/enterprise-billing-contract";

import { customerIoChannels } from "../channels/customer-io-channels.registry.ts";
import type { CustomerIoChannel } from "../channels/customer-io.channel.ts";
import {
  NullBillingErrorReporter,
  type BillingErrorReporter,
} from "./billing-error-reporter.service.ts";

export type NurturingServiceOptions = {
  config: {
    customerIoApiKey?: string;
    customerIoRegion?: string;
  };
  fetchFn?: typeof fetch;
  errorReporter?: BillingErrorReporter;
  channel?: CustomerIoChannel;
};

/** Billing's named Customer.io operations over the configured delivery channel. */
export class NurturingService {
  private readonly channel: CustomerIoChannel;

  private constructor(options: NurturingServiceOptions) {
    this.channel =
      options.channel ??
      customerIoChannels.live.create({
        config: options.config,
        fetchFn: options.fetchFn,
        errorReporter: options.errorReporter ?? NullBillingErrorReporter.create(),
      });
  }

  static create(options: NurturingServiceOptions): NurturingService {
    return new NurturingService(options);
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
