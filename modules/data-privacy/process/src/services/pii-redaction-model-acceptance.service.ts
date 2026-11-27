/**
 * An organization admin's acceptance of the PII Redaction Model's price, kept on the organization
 * (ADR-201 decision 15). Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */
import type { OrganizationApi } from "@langwatch/organization-contract";

type OrganizationAcceptances = Pick<
  OrganizationApi,
  "isPiiRedactionModelAccepted" | "recordPiiRedactionModelAcceptance"
>;

export class PiiRedactionModelAcceptanceService {
  static create(input: {
    organizations: OrganizationAcceptances;
  }): PiiRedactionModelAcceptanceService {
    return new PiiRedactionModelAcceptanceService(input.organizations);
  }

  private constructor(private readonly organizations: OrganizationAcceptances) {}

  isAccepted(input: { organizationId: string }): Promise<boolean> {
    return this.organizations.isPiiRedactionModelAccepted(input);
  }

  /** The door authorized the admin on this organization; the first acceptance is the one kept. */
  accept(input: { organizationId: string; userId: string }): Promise<void> {
    return this.organizations.recordPiiRedactionModelAcceptance(input);
  }
}
