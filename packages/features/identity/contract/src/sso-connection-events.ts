/**
 * The SSO connection pipeline's framework identity (ADR-117 §5, D04). One
 * aggregate per connection (`aggregateId = connectionId`), and the
 * ORGANIZATION is the tenant (`tenantId = organizationId`) — a connection is
 * org-level configuration, so an organization's connections are one tenant's
 * history and support can read them in a single tenant scan.
 *
 * Why this is its own pipeline rather than a second aggregate inside the
 * identity one, which is how ADR-117 §5 phrases it: a pipeline declares ONE
 * aggregate type and the event store refuses at append any event whose type
 * differs from it (#7406, and the authz pipeline's docblock says the same).
 * The identity pipeline declares `user_identity` and is tenanted by the USER;
 * a connection is neither. So the aggregate lives beside it and keeps the
 * identity vocabulary — the events are `lw.identity.connection_*`, the facts
 * are this package's, the guards are `@langwatch/identity-server`'s. What is
 * separate is the storage partition, which is the only thing the framework
 * was ever going to let us share.
 *
 * The sign-in hot path never reads these — it reads the Postgres
 * `SsoConnection` projection the fold maintains.
 *
 * The wire schemas that extend the payloads above with the framework
 * envelope live in `@langwatch/identity-server`, next to the pipeline
 * definition — this package stays free of the `@langwatch/eventing`
 * framework so the frontend can import it verbatim.
 */
export const SSO_CONNECTION_PIPELINE_NAME = "sso-connections" as const;
export const SSO_CONNECTION_AGGREGATE_TYPE = "sso_connection" as const;
