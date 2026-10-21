import type { AuthzOrganizationPolicy } from "@langwatch/authz-contract";

/** ADR-183 §2: an organisation's authz settings; an organisation with no row has every one off. */
export abstract class AuthzOrganizationPolicyRepository {
  abstract getPolicy(input: { organizationId: string }): Promise<AuthzOrganizationPolicy>;

  abstract setBraidsOrganizationAdminsOnly(input: {
    organizationId: string;
    braidsOrganizationAdminsOnly: boolean;
    updatedByUserId: string;
  }): Promise<void>;
}
