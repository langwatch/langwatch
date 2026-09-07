import type { UsageLimitEmailData } from "../services/billing-usage-notice.service.ts";

export abstract class UsageLimitEmailPort {
  abstract send(input: {
    to: string;
    organizationName: string;
    usage: UsageLimitEmailData;
  }): Promise<void>;
}

export class NullUsageLimitEmailAdapter extends UsageLimitEmailPort {
  private constructor() {
    super();
  }

  static create(): NullUsageLimitEmailAdapter {
    return new NullUsageLimitEmailAdapter();
  }

  async send(): Promise<void> {}
}
