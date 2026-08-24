import {
  BillingErrorReporter,
  UsageLimitEmailAdapter,
  type UsageLimitEmailData,
} from "~/runtime/app/features/billing";
import { sendUsageLimitEmail } from "~/server/mailer/usageLimitEmail";
import { captureException } from "~/utils/posthogErrorCapture";

export class AppBillingErrorReporter extends BillingErrorReporter {
  private constructor() {
    super();
  }

  static create(): AppBillingErrorReporter {
    return new AppBillingErrorReporter();
  }

  capture(error: Error, context?: Record<string, unknown>): void {
    captureException(error, context ? { extra: context } : undefined);
  }
}

export class AppUsageLimitEmailAdapter extends UsageLimitEmailAdapter {
  private constructor() {
    super();
  }

  static create(): AppUsageLimitEmailAdapter {
    return new AppUsageLimitEmailAdapter();
  }

  async send(input: {
    to: string;
    organizationName: string;
    usage: UsageLimitEmailData;
  }): Promise<void> {
    await sendUsageLimitEmail({
      to: input.to,
      ...input.usage,
    });
  }
}
