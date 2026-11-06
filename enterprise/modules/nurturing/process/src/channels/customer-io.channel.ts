import type {
  CioBatchCall,
  CioEventName,
  CioOrgTraits,
  CioPersonTraits,
} from "@langwatch/enterprise-nurturing-contract";

export type CustomerIoChannelOptions = {
  config: {
    customerIoApiKey?: string;
    customerIoRegion?: string;
    customerIoBaseUrl?: string;
  };
  fetchFn?: typeof fetch;
  errorReporter?: { capture(error: Error, context?: Record<string, unknown>): void };
};

export abstract class CustomerIoChannel {
  abstract identifyUser(input: { userId: string; traits: Partial<CioPersonTraits> }): Promise<void>;
  abstract trackEvent(input: {
    userId: string;
    event: CioEventName;
    properties?: Record<string, unknown>;
    messageId?: string;
  }): Promise<void>;
  abstract groupUser(input: {
    userId: string;
    groupId: string;
    traits?: Partial<CioOrgTraits>;
  }): Promise<void>;
  abstract batch(calls: CioBatchCall[]): Promise<void>;

  /**
   * As trackEvent, but rejects when the channel knows Customer.io did not take the track, for the
   * one caller that gives a claim back on failure. A channel that cannot tell resolves as
   * trackEvent does.
   */
  trackEventOrThrow(input: Parameters<CustomerIoChannel["trackEvent"]>[0]): Promise<void> {
    return this.trackEvent(input);
  }
}
