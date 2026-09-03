export abstract class BillingErrorReporter {
  abstract capture(error: Error, context?: Record<string, unknown>): void;
}

export class NullBillingErrorReporter extends BillingErrorReporter {
  private constructor() {
    super();
  }

  static create(): NullBillingErrorReporter {
    return new NullBillingErrorReporter();
  }

  capture(): void {}
}
