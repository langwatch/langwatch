export type LicenseUsageCount = number | "unlimited" | "unknown";

export abstract class LicenseUsagePort {
  abstract getCurrentMonthCount(input: {
    organizationId: string;
  }): Promise<LicenseUsageCount>;
}
