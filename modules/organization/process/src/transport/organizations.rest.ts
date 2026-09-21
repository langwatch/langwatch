import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
/** `/api/organizations`: admin-only provisioning with instance bearer key. */
import { NotFoundError } from "@langwatch/handled-error";
import {
  OrganizationApi,
  organizationsProvisioningRestCreatedSchema,
  organizationsProvisioningRestCreateSchema,
  organizationsProvisioningRestGotOneSchema,
  organizationsProvisioningRestListSchema,
  organizationsProvisioningRestParamsSchema,
} from "@langwatch/organization-contract";
import { toDate } from "@langwatch/time";

export const organizationsProvisioningRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<OrganizationApi>;
}> = defineRestRouter(OrganizationApi)
  .withNamespace("organizations")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("instance-admin")

  .post("/", "provisionOrganization")
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
  .handle(async ({ app, input }) => {
    const provisioned = await app.createForProvisioningWithAdminKey({
      name: input.name,
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.adminApiKeyName !== undefined ? { adminApiKeyName: input.adminApiKeyName } : {}),
    });

    return provisioned;
  })

  .get("/", "listOrganizations")
  .withAccess({
    kind: "authenticated",
    reason:
      "Holding the instance administrator bearer key is the only authority this door checks; there is no tenant to ask a permission of.",
  })
  .withOutput(organizationsProvisioningRestListSchema)
  .withDocs({
    tags: ["Organizations (Self-Hosted)"],
    description:
      "List every organization this instance hosts, self-hosted instance administrators only.",
  })
  .handle(async ({ app }) => ({
    organizations: (await app.listProvisioningSummaries()).map((organization) => ({
      ...organization,
      createdAt: toDate(organization.createdAt),
    })),
  }))

  .get("/:organizationId", "getOrganizationById")
  .withAccess({
    kind: "authenticated",
    reason:
      "Holding the instance administrator bearer key is the only authority this door checks; there is no tenant to ask a permission of.",
  })
  .withParams(organizationsProvisioningRestParamsSchema)
  .withOutput(organizationsProvisioningRestGotOneSchema)
  .withDocs({
    tags: ["Organizations (Self-Hosted)"],
    description:
      "Read one organization's provisioning summary, self-hosted instance administrators only.",
  })
  .handle(async ({ app, input }) => {
    const organization = await app.findProvisioningSummary(input.organizationId);
    if (!organization) throw new NotFoundError("not_found", "Organization", input.organizationId);

    return {
      organization: { ...organization, createdAt: toDate(organization.createdAt) },
    };
  })

  .build();
