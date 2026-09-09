export type LicenseRetentionRule = {
  scopeType: string;
  scopeId: string;
  category: string;
};

export abstract class LicenseRetentionPort {
  abstract listOrganizationRules(organizationId: string): Promise<readonly LicenseRetentionRule[]>;

  abstract setForOrganization(input: {
    organizationId: string;
    category: string;
    retentionDays: number;
  }): Promise<void>;
}
