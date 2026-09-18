/**
 * Session policy: maxSessionDurationDays hard cap on CLI/device lifetime (0 = unbounded).
 * Kept as repository—it's just one Organization column; service layer enforces the range.
 */
export type OrganizationSessionPolicy = Readonly<{
  maxSessionDurationDays: number;
}>;

export abstract class OrganizationSessionPolicyRepository {
  abstract find(organizationId: string): Promise<OrganizationSessionPolicy>;
  abstract setMaxDurationDays(
    organizationId: string,
    maxSessionDurationDays: number,
  ): Promise<void>;
}
