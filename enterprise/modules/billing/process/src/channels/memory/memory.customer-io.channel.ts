import type {
  CioBatchCall,
  CioEventName,
  CioOrgTraits,
  CioPersonTraits,
} from "@langwatch/enterprise-billing-contract";

import { CustomerIoChannel } from "../customer-io.channel.ts";

export class MemoryCustomerIoChannel extends CustomerIoChannel {
  static readonly requires: readonly [] = [];

  private constructor() {
    super();
  }

  static create(): MemoryCustomerIoChannel {
    return new MemoryCustomerIoChannel();
  }

  async identifyUser(_input: { userId: string; traits: Partial<CioPersonTraits> }): Promise<void> {}

  async trackEvent(_input: {
    userId: string;
    event: CioEventName;
    properties?: Record<string, unknown>;
  }): Promise<void> {}

  async groupUser(_input: {
    userId: string;
    groupId: string;
    traits?: Partial<CioOrgTraits>;
  }): Promise<void> {}

  async batch(_calls: CioBatchCall[]): Promise<void> {}
}
