/** Identity pipeline framework identity: one aggregate per user, where userId serves as both
 * aggregateId and tenantId for single-tenant erasure and support lookups. See ADR-101.
 */
export const IDENTITY_PIPELINE_NAME = "identity" as const;
export const USER_IDENTITY_AGGREGATE_TYPE = "user_identity" as const;
