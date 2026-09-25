import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type {
  OrganizationSessionPolicyShape,
  SessionCeilingApplied,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

/**
 * Main's `sessionPolicy` router: organization owns the setting, and api-key
 * owns the login keys it bounds.
 */
export class OrganizationSessionPolicyService {
  private constructor(
    private readonly organizations: Pick<OrganizationApi, "getSessionPolicy" | "saveSessionPolicy">,
    private readonly loginKeys: Pick<ApiKeyApi, "applySessionCeiling">,
  ) {}

  static create(options: {
    organizations: Pick<OrganizationApi, "getSessionPolicy" | "saveSessionPolicy">;
    loginKeys: Pick<ApiKeyApi, "applySessionCeiling">;
  }): OrganizationSessionPolicyService {
    return new OrganizationSessionPolicyService(options.organizations, options.loginKeys);
  }

  get(input: { organizationId: string }): Promise<OrganizationSessionPolicyShape> {
    return this.organizations.getSessionPolicy(input);
  }

  /** The new ceiling applies to open sessions now, not at their next refresh. */
  async setMaxDuration(input: {
    organizationId: string;
    maxSessionDurationDays: number;
  }): Promise<SessionCeilingApplied> {
    await this.organizations.saveSessionPolicy(input);
    const reapedSessions = await this.loginKeys.applySessionCeiling(input);
    return { ok: true, reapedSessions };
  }
}
