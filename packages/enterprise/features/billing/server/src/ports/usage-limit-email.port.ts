import type { UsageLimitEmailData } from "../services/notification.service";

export abstract class UsageLimitEmailAdapter {
  abstract send(input: {
    to: string;
    organizationName: string;
    usage: UsageLimitEmailData;
  }): Promise<void>;
}

export class NullUsageLimitEmailAdapter extends UsageLimitEmailAdapter {
  private constructor() {
    super();
  }

  static create(): NullUsageLimitEmailAdapter {
    return new NullUsageLimitEmailAdapter();
  }

  async send(): Promise<void> {}
}
