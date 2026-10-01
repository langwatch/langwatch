import { GatewayOrganizationNotFoundError } from "@langwatch/gateway-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

import { isMemberNotFound } from "../rules/gateway-organization-peer.rules.ts";

/** The two organization facts the control plane's doors ask before they act. */
export class GatewayOrganizationDirectoryService {
  static create(input: {
    organizations: Pick<OrganizationApi, "findProvisioningSummary" | "getMember">;
  }): GatewayOrganizationDirectoryService {
    return new GatewayOrganizationDirectoryService(input.organizations);
  }

  private constructor(
    private readonly organizations: Pick<OrganizationApi, "findProvisioningSummary" | "getMember">,
  ) {}

  /** Refuses an organization id that names no organization. */
  async assertExists(organizationId: string): Promise<void> {
    const summary = await this.organizations.findProvisioningSummary(organizationId);
    if (summary === null) {
      throw new GatewayOrganizationNotFoundError();
    }
  }

  /** Whether a user holds a membership here, a disabled one included. */
  async isMember(input: { organizationId: string; userId: string }): Promise<boolean> {
    try {
      await this.organizations.getMember(input);

      return true;
    } catch (error) {
      if (isMemberNotFound(error)) return false;

      throw error;
    }
  }
}
