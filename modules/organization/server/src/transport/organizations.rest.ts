/**
 * `/api/organizations` - instance administrator organization provisioning,
 * self-hosted only. Answers behind the instance administrator bearer key
 * rather than a tenant credential, so every route resolves no organization
 * scope of its own; each one is handed the organization id it addresses as
 * plain input instead. Minting the bootstrap admin key and compensating a
 * failed provisioning run are the application's own orchestration, over its
 * `apiKeys` peer.
 */
import { NotFoundError } from "@langwatch/handled-error";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { OrganizationApi } from "@langwatch/organization-contract";
import { toDate } from "@langwatch/time";

import {
  organizationsProvisioningRestCreatedSchema,
  organizationsProvisioningRestCreateSchema,
  organizationsProvisioningRestGotOneSchema,
  organizationsProvisioningRestListSchema,
  organizationsProvisioningRestParamsSchema,
} from "@langwatch/organization-contract";

export const organizationsProvisioningRest = defineRestRouter(OrganizationApi)
  .withNamespace("organizations")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("instance-admin")

  .post("/", "createOrganization")
  .withAccess({
    kind: "authenticated",
    reason: "Holding the instance administrator bearer key is the only authority this door checks; there is no tenant to ask a permission of.",
  })
  .withInput(organizationsProvisioningRestCreateSchema)
  .withOutput(organizationsProvisioningRestCreatedSchema)
  .withStatus(201)
  .withDocs({
    tags: ["Organizations"],
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
    reason: "Holding the instance administrator bearer key is the only authority this door checks; there is no tenant to ask a permission of.",
  })
  .withOutput(organizationsProvisioningRestListSchema)
  .withDocs({
    tags: ["Organizations"],
    description: "List every organization this instance hosts, self-hosted instance administrators only.",
  })
  .handle(async ({ app }) => ({
    organizations: (await app.listProvisioningSummaries()).map((organization) => ({
      ...organization,
      createdAt: toDate(organization.createdAt),
    })),
  }))

  .get("/:id", "getOrganization")
  .withAccess({
    kind: "authenticated",
    reason: "Holding the instance administrator bearer key is the only authority this door checks; there is no tenant to ask a permission of.",
  })
  .withParams(organizationsProvisioningRestParamsSchema)
  .withOutput(organizationsProvisioningRestGotOneSchema)
  .withDocs({
    tags: ["Organizations"],
    description: "Read one organization's provisioning summary, self-hosted instance administrators only.",
  })
  .handle(async ({ app, input }) => {
    const organization = await app.findProvisioningSummary(input.id);
    if (!organization) throw new NotFoundError("not_found", "Organization", input.id);

    return {
      organization: { ...organization, createdAt: toDate(organization.createdAt) },
    };
  })

  .build();
