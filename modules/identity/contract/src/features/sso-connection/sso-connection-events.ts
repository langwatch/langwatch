/**
 * SSO connection pipeline framework identity (ADR-117 §5), separate from the
 * identity pipeline. This package avoids `@langwatch/eventing` so the
 * frontend can import it; wire schemas live in `@langwatch/identity-process`.
 */
export const SSO_CONNECTION_PIPELINE_NAME = "sso-connections" as const;
export const SSO_CONNECTION_AGGREGATE_TYPE = "sso_connection" as const;
