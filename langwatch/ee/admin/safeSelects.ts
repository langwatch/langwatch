import type { Prisma } from "@prisma/client";

/**
 * Prisma `select` clauses used by the admin Hono routes for read operations
 * (getList / getOne). Credentials — Elasticsearch API key + URL, every S3
 * field — are intentionally omitted so secrets never reach the admin UI in
 * paginated list payloads or edit-drawer fetches.
 *
 * Operators can still *write* new credential values (the update payload
 * goes through `defaultHandler` which passes the whole `params.data`
 * straight to Prisma) — this file just controls what the server is willing
 * to *return*. Matches the standard "secrets are write-only over the wire"
 * pattern.
 *
 * Lives in ee/admin/ because the admin surface is enterprise-edition
 * functionality; server routes in src/ import from here.
 */

export const ORGANIZATION_SAFE_SELECT = {
  id: true,
  name: true,
  phoneNumber: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
  usageSpendingMaxLimit: true,
  signupData: true,
  signedDPA: true,
  useCustomElasticsearch: true,
  useCustomS3: true,
  sentPlanLimitAlert: true,
  ssoDomain: true,
  ssoProvider: true,
  promoCode: true,
  stripeCustomerId: true,
  currency: true,
  pricingModel: true,
  license: true,
  licenseExpiresAt: true,
  licenseLastValidatedAt: true,
} as const satisfies Prisma.OrganizationSelect;

export const PROJECT_SAFE_SELECT = {
  id: true,
  name: true,
  slug: true,
  apiKey: true,
  teamId: true,
  language: true,
  framework: true,
  firstMessage: true,
  integrated: true,
  createdAt: true,
  updatedAt: true,
  userLinkTemplate: true,
  piiRedactionLevel: true,
  capturedInputVisibility: true,
  capturedOutputVisibility: true,
  traceSharingEnabled: true,
  defaultModel: true,
  topicClusteringModel: true,
  embeddingsModel: true,
  archivedAt: true,
} as const satisfies Prisma.ProjectSelect;
