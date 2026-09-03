import { AUDIT_LOG_FEATURE_ID } from "@langwatch/enterprise-audit-log-contract";
import { BILLING_FEATURE_ID } from "@langwatch/enterprise-billing-contract";
import { GOVERNANCE_FEATURE_ID } from "@langwatch/enterprise-governance-contract";
import { LICENSING_FEATURE_ID } from "@langwatch/enterprise-licensing-contract";
import { MANAGED_PROVIDER_FEATURE_ID } from "@langwatch/enterprise-managed-provider-contract";
import { SAAS_FEATURE_ID } from "@langwatch/enterprise-saas-contract";
import { SCIM_FEATURE_ID } from "@langwatch/enterprise-scim-contract";
import { SSO_FEATURE_ID } from "@langwatch/enterprise-sso-contract";
import { WEBHOOK_FEATURE_ID } from "@langwatch/enterprise-webhook-contract";
import { z } from "zod";

export const enterpriseFeatureIdSchema = z.enum([
  LICENSING_FEATURE_ID,
  SSO_FEATURE_ID,
  SCIM_FEATURE_ID,
  AUDIT_LOG_FEATURE_ID,
  BILLING_FEATURE_ID,
  GOVERNANCE_FEATURE_ID,
  MANAGED_PROVIDER_FEATURE_ID,
  SAAS_FEATURE_ID,
  WEBHOOK_FEATURE_ID,
]);
export type EnterpriseFeatureId = z.infer<typeof enterpriseFeatureIdSchema>;

export const enterpriseFeatureDescriptorSchema = z.object({
  id: enterpriseFeatureIdSchema,
  contractPackage: z.string().min(1),
  serverPackage: z.string().min(1).optional(),
  webPackage: z.string().min(1).optional(),
});
export type EnterpriseFeatureDescriptor = z.infer<typeof enterpriseFeatureDescriptorSchema>;

const LICENSING_DESCRIPTOR = enterpriseFeatureDescriptorSchema.parse({
  id: LICENSING_FEATURE_ID,
  contractPackage: "@langwatch/enterprise-licensing-contract",
  serverPackage: "@langwatch/enterprise-licensing-server",
});

const SSO_DESCRIPTOR = enterpriseFeatureDescriptorSchema.parse({
  id: SSO_FEATURE_ID,
  contractPackage: "@langwatch/enterprise-sso-contract",
  serverPackage: "@langwatch/enterprise-sso-server",
});

const SCIM_DESCRIPTOR = enterpriseFeatureDescriptorSchema.parse({
  id: SCIM_FEATURE_ID,
  contractPackage: "@langwatch/enterprise-scim-contract",
  serverPackage: "@langwatch/enterprise-scim-server",
});

const AUDIT_LOG_DESCRIPTOR = enterpriseFeatureDescriptorSchema.parse({
  id: AUDIT_LOG_FEATURE_ID,
  contractPackage: "@langwatch/enterprise-audit-log-contract",
  serverPackage: "@langwatch/enterprise-audit-log-server",
});

const BILLING_DESCRIPTOR = enterpriseFeatureDescriptorSchema.parse({
  id: BILLING_FEATURE_ID,
  contractPackage: "@langwatch/enterprise-billing-contract",
  serverPackage: "@langwatch/enterprise-billing-server",
  webPackage: "@langwatch/enterprise-billing-web",
});

const GOVERNANCE_DESCRIPTOR = enterpriseFeatureDescriptorSchema.parse({
  id: GOVERNANCE_FEATURE_ID,
  contractPackage: "@langwatch/enterprise-governance-contract",
  serverPackage: "@langwatch/enterprise-governance-server",
  webPackage: "@langwatch/enterprise-governance-web",
});

const MANAGED_PROVIDERS_DESCRIPTOR = enterpriseFeatureDescriptorSchema.parse({
  id: MANAGED_PROVIDER_FEATURE_ID,
  contractPackage: "@langwatch/enterprise-managed-provider-contract",
  serverPackage: "@langwatch/enterprise-managed-provider-server",
  webPackage: "@langwatch/enterprise-managed-provider-web",
});

const SAAS_DESCRIPTOR = enterpriseFeatureDescriptorSchema.parse({
  id: SAAS_FEATURE_ID,
  contractPackage: "@langwatch/enterprise-saas-contract",
  webPackage: "@langwatch/enterprise-saas-web",
});

const WEBHOOKS_DESCRIPTOR = enterpriseFeatureDescriptorSchema.parse({
  id: WEBHOOK_FEATURE_ID,
  contractPackage: "@langwatch/enterprise-webhook-contract",
  serverPackage: "@langwatch/enterprise-webhook-server",
});

/** Portable feature discovery. Runtime installers belong to composition packages. */
export class EnterpriseCatalogue {
  private constructor(private readonly descriptors: readonly EnterpriseFeatureDescriptor[]) {}

  static create(): EnterpriseCatalogue {
    return new EnterpriseCatalogue([
      LICENSING_DESCRIPTOR,
      SSO_DESCRIPTOR,
      SCIM_DESCRIPTOR,
      AUDIT_LOG_DESCRIPTOR,
      BILLING_DESCRIPTOR,
      GOVERNANCE_DESCRIPTOR,
      MANAGED_PROVIDERS_DESCRIPTOR,
      SAAS_DESCRIPTOR,
      WEBHOOKS_DESCRIPTOR,
    ]);
  }

  list(): readonly EnterpriseFeatureDescriptor[] {
    return this.descriptors;
  }

  get(id: EnterpriseFeatureId): EnterpriseFeatureDescriptor | undefined {
    return this.descriptors.find((descriptor) => descriptor.id === id);
  }
}
