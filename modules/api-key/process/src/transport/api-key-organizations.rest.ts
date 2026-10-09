import {
  organizationsProvisioningRestCreatedSchema,
  organizationsProvisioningRestCreateSchema,
  type OrganizationProvisioningRequest,
  type ProvisionedOrganization,
} from "@langwatch/api-key-contract";
/**
 * `POST /api/organizations`: an organization provisioned with its bootstrap admin
 * key, self-hosted instance administrators only. Served by api-key, which mints
 * the key, at organization's published path (ARCHITECTURE.md §8, R3, R10).
 */
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";

/** What the organization provisioning door reaches; `ApiKeyModule` serves it. */
export interface ApiKeyOrganizationsDoorApi {
  provisionOrganization(input: OrganizationProvisioningRequest): Promise<ProvisionedOrganization>;
}

export const ApiKeyOrganizationsDoorApi = moduleApi<ApiKeyOrganizationsDoorApi>()("api-key");

const ORGANIZATIONS_SHARED_PATH = {
  owner: "organization",
  reason:
    "provisioning mints the bootstrap admin key, so api-key serves it at organization's path (R3, R10)",
  deprecate: "fold into /api/organizations once organization provisions without api-key",
} as const;

export const apiKeyOrganizationsRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<ApiKeyOrganizationsDoorApi>;
}> = defineRestRouter(ApiKeyOrganizationsDoorApi)
  .withNamespace("organizations")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("instance_admin")

  .post("/", "provisionOrganization")
  .withSharedPath(ORGANIZATIONS_SHARED_PATH)
  .withAccess({
    kind: "authenticated",
    reason:
      "Holding the instance administrator bearer key is the only authority this door checks; there is no tenant to ask a permission of.",
  })
  .withInput(organizationsProvisioningRestCreateSchema)
  .withOutput(organizationsProvisioningRestCreatedSchema)
  .withStatus(201)
  .withDocs({
    tags: ["Organizations (Self-Hosted)"],
    description:
      "Provision a new organization with its first team and a bootstrap admin service key, self-hosted instance administrators only.",
  })
  .handle(({ app, input }) =>
    app.provisionOrganization({
      name: input.name,
      slug: input.slug,
      adminApiKeyName: input.adminApiKeyName,
    }),
  )
  .build();
