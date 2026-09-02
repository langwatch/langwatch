/**
 * The identity platform's event-sourcing layer.
 *
 * ADR-115 split identity into a pure core (`@langwatch/identity`) and a
 * framework-free server runtime (`@langwatch/identity-server`), and left the
 * framework half — the envelope, the thin command handlers, the folds, the
 * process managers and the pipeline definitions — inside `platform/app`,
 * because at the time the app was the only thing that composed them. The core
 * application exit deletes that host, so the framework half lives here: one
 * package that both the API process and the worker process can import, and
 * that `@langwatch/identity-server` still never imports back.
 *
 * The direction is unchanged from ADR-115's diagram, with one hop added at the
 * bottom:
 *
 *   @langwatch/identity  <-  @langwatch/identity-server  <-  @langwatch/identity-eventing
 *
 * Every pipeline factory still takes its stores, guards and ports as
 * constructor arguments, exactly as it did when the registry in `platform/app`
 * supplied them. What has been added is the POSTGRES BINDING of the two folds
 * this package owns outright — the `Identifier` / `MfaEnrollment` head and the
 * `ScimSyncState` head — under `repositories/prisma` with an
 * `adapters/postgres.*.adapter.ts` seam over each.
 *
 * They live here rather than in `@langwatch/identity-server` because they are
 * bindings of THIS package's fold state: a projection store is typed by the
 * state it stores, and a package that named `IdentityFoldState` would have to
 * depend back on this one, which is the arrow the diagram above forbids. The
 * guard-side reads, which are `@langwatch/identity-server`'s own ports, stayed
 * with those ports.
 *
 * Nothing above an adapter names Prisma, and no factory reaches for one: a
 * caller that wants a different engine still composes the pipeline itself.
 */

export {
  type IdentityPipelineDatabase,
  PostgresIdentityPipelineAdapter,
  type PostgresIdentityPipelineOptions,
} from "./adapters/postgres.identity-pipeline.adapter";
export {
  PostgresScimSyncPipelineAdapter,
  type PostgresScimSyncPipelineOptions,
  type ScimSyncPipelineDatabase,
} from "./adapters/postgres.scim-sync-pipeline.adapter";
export { identityEventsFor, mfaEventsFor } from "./identity/envelope";
export {
  createIdentityPipeline,
  type IdentityPipeline,
  type IdentityPipelineDeps,
} from "./identity/pipeline";
export {
  type IdentityFoldState,
  IdentityStateFoldProjection,
} from "./identity/projections/identityState.foldProjection";
export {
  MfaEnrollmentStateFoldProjection,
  type MfaFoldState,
} from "./identity/projections/mfaEnrollmentState.foldProjection";
export { IDENTITY_PIPELINE_NAME, USER_IDENTITY_AGGREGATE_TYPE } from "./identity/schemas/constants";
export {
  type IdentifierAttachedEvent,
  type IdentifierDeadEndedEvent,
  type IdentifierDetachedEvent,
  type IdentifierVerifiedEvent,
  type IdentityEvent,
  identityEventSchema,
  type LinkProposedEvent,
  type PrimaryChangedEvent,
  type UserErasedEvent,
} from "./identity/schemas/events";
export {
  type BackupCodeConsumedEvent,
  type BackupCodesRegeneratedEvent,
  type MfaConfirmedEvent,
  type MfaDisabledEvent,
  type MfaEnrolledEvent,
  type MfaEnrollmentExpiredEvent,
  type MfaEvent,
  mfaEventSchema,
  type MfaVerificationFailedEvent,
} from "./identity/schemas/mfaEvents";

export { ssoConnectionEventsFor } from "./sso-connections/envelope";
export {
  createSsoConnectionPipeline,
  type SsoConnectionPipelineDeps,
} from "./sso-connections/pipeline";
export {
  CONNECTION_TEARDOWN_GRACE_MS,
  CONNECTION_TEARDOWN_PROCESS_NAME,
  type ConnectionTeardownPort,
  type ConnectionTeardownState,
} from "./sso-connections/process-manager/connectionTeardown.process";
export {
  SSO_CONNECTION_PROJECTION_NAME,
  type SsoConnectionFoldState,
  SsoConnectionStateFoldProjection,
} from "./sso-connections/projections/ssoConnectionState.foldProjection";
export {
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_PIPELINE_NAME,
} from "./sso-connections/schemas/constants";
export {
  type SsoConnectionEvent,
  ssoConnectionEventSchema,
} from "./sso-connections/schemas/events";

export { joinRequestEventsFor } from "./join-requests/envelope";
export {
  createJoinRequestPipeline,
  type JoinRequestPipeline,
  type JoinRequestPipelineDeps,
} from "./join-requests/pipeline";
export {
  EventingJoinRequestLedgerAdapter,
  JOIN_REQUEST_CONVERGENCE_POLL_MS,
  JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS,
  type EventingJoinRequestLedgerOptions,
  type JoinRequestStagedSender,
} from "./adapters/eventing.join-request-ledger.adapter";
export {
  EventingJoinRequestLifecycleAdapter,
  type EventingJoinRequestLifecycleOptions,
} from "./adapters/eventing.join-request-lifecycle.adapter";
export {
  PostgresJoinRequestPipelineAdapter,
  type JoinRequestPipelineDatabase,
  type PostgresJoinRequestPipelineOptions,
} from "./adapters/postgres.join-request-pipeline.adapter";
export {
  JOIN_REQUEST_EXPIRY_MS,
  JOIN_REQUEST_LIFECYCLE_PROCESS_NAME,
  JOIN_REQUEST_REMINDER_MS,
  type JoinRequestLifecyclePort,
  type JoinRequestLifecycleState,
} from "./join-requests/process-manager/joinRequestLifecycle.process";
export {
  JOIN_REQUEST_PROJECTION_NAME,
  type JoinRequestFoldState,
  JoinRequestStateFoldProjection,
} from "./join-requests/projections/joinRequestState.foldProjection";
export {
  JOIN_REQUEST_AGGREGATE_TYPE,
  JOIN_REQUEST_PIPELINE_NAME,
} from "./join-requests/schemas/constants";
export { type JoinRequestEvent, joinRequestEventSchema } from "./join-requests/schemas/events";

export { scimSyncEventsFor } from "./scim-sync/envelope";
export {
  createScimSyncPipeline,
  type ScimSyncPipeline,
  type ScimSyncPipelineDeps,
} from "./scim-sync/pipeline";
export {
  SCIM_SYNC_PROJECTION_NAME,
  type ScimSyncFoldState,
  ScimSyncStateFoldProjection,
} from "./scim-sync/projections/scimSyncState.foldProjection";
export { SCIM_SYNC_AGGREGATE_TYPE, SCIM_SYNC_PIPELINE_NAME } from "./scim-sync/schemas/constants";
export { type ScimSyncEvent, scimSyncEventSchema } from "./scim-sync/schemas/events";
