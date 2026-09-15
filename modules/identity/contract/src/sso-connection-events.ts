/**
 * SSO connection pipeline framework identity (ADR-117 §5). Separate from the identity
 * pipeline because connections are neither user identities; a pipeline declares one aggregate
 * type. Sign-in hot path reads Postgres SsoConnection projection. Wire schemas in
 * @langwatch/identity-server; this package avoids @langwatch/eventing so frontend can import it.
 */
export const SSO_CONNECTION_PIPELINE_NAME = "sso-connections" as const;
export const SSO_CONNECTION_AGGREGATE_TYPE = "sso_connection" as const;
