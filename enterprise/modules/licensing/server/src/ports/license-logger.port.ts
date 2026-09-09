export abstract class LicenseLoggerPort {
  abstract error(fields: Record<string, unknown>, message: string): void;
}
