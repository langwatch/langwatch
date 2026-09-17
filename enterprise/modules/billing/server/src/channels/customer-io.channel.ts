import type {
  CioBatchCall,
  CioEventName,
  CioOrgTraits,
  CioPersonTraits,
} from "@langwatch/enterprise-billing-contract";

export type CustomerIoChannelOptions = {
  config: {
    customerIoApiKey?: string;
    customerIoRegion?: string;
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
  }): Promise<void>;
  abstract groupUser(input: {
    userId: string;
    groupId: string;
    traits?: Partial<CioOrgTraits>;
  }): Promise<void>;
  abstract batch(calls: CioBatchCall[]): Promise<void>;
}
