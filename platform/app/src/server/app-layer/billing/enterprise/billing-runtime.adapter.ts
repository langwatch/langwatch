import {
  BillingErrorReporter,
  UsageLimitEmailAdapter,
  type UsageLimitEmailData,
} from "~/runtime/app/features/billing";
import { sendUsageLimitEmail } from "~/server/mailer/usageLimitEmail";
import type { EmailDeliveryPort } from "~/server/mailer/providers/types";
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
  private constructor(private readonly mailer: EmailDeliveryPort) {
    super();
  }

  static create(mailer: EmailDeliveryPort): AppUsageLimitEmailAdapter {
    return new AppUsageLimitEmailAdapter(mailer);
  }

  async send(input: {
    to: string;
    organizationName: string;
    usage: UsageLimitEmailData;
  }): Promise<void> {
    await sendUsageLimitEmail({
      mailer: this.mailer,
      to: input.to,
      ...input.usage,
    });
  }
}
