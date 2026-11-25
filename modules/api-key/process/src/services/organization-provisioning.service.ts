import type {
  ApiKeyApi,
  OrganizationProvisioningRequest,
  ProvisionedOrganization,
} from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";

const logger = createLogger("langwatch:api-key:organization-provisioning");

/**
 * `POST /api/organizations`: organization creates the organization, api-key mints
 * its bootstrap admin key. A failure past creation deletes the organization
 * (unreachable without its key); the caller sees the ORIGINAL failure.
 */
export class OrganizationProvisioningService {
  static create(options: {
    apiKeys: Pick<ApiKeyApi, "create">;
    organizations: Pick<
      OrganizationApi,
      "createForProvisioning" | "findProvisioningSummary" | "deleteProvisionedOrganization"
    >;
  }): OrganizationProvisioningService {
    return new OrganizationProvisioningService(options);
  }

  private constructor(
    private readonly options: {
      apiKeys: Pick<ApiKeyApi, "create">;
      organizations: Pick<
        OrganizationApi,
        "createForProvisioning" | "findProvisioningSummary" | "deleteProvisionedOrganization"
      >;
    },
  ) {}

  async provisionOrganization(
    input: OrganizationProvisioningRequest,
  ): Promise<ProvisionedOrganization> {
    const { organizations, apiKeys } = this.options;
    const created = await organizations.createForProvisioning({
      name: input.name,
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
    });
    const organizationId = created.organization.id;

    try {
      const adminKey = await apiKeys.create({
        name: input.adminApiKeyName ?? "Provisioning admin",
        userId: null,
        createdByUserId: null,
        organizationId,
        permissionMode: "all",
        bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: organizationId }],
      });
      const summary = await organizations.findProvisioningSummary(organizationId);
      // The slug is the natural key a members-as-code caller stores; a blank one
      // would move the failure far from its cause.
      if (!summary) {
        throw new Error(`provisioned organization ${organizationId} could not be read back`);
      }

      return {
        organization: { id: organizationId, name: created.organization.name, slug: summary.slug },
        team: created.team,
        adminApiKey: { id: adminKey.apiKey.id, token: adminKey.token },
      };
    } catch (error) {
      try {
        await organizations.deleteProvisionedOrganization({ organizationId });
      } catch (compensationError) {
        logger.error(
          { organizationId, error: compensationError },
          "a failed provisioning could not delete the organization it created",
        );
      }
      throw error;
    }
  }
}
