export abstract class BillingErrorReporterPort {
  abstract capture(error: Error, context?: Record<string, unknown>): void;
}

export class NullBillingErrorReporter extends BillingErrorReporterPort {
  private constructor() {
    super();
  }

  static create(): NullBillingErrorReporter {
    return new NullBillingErrorReporter();
  }

  capture(): void {}
}
