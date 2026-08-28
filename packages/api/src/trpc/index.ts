// ---------------------------------------------------------------------------
// @langwatch/api/trpc -- the typed tRPC root and the policy spine it runs
//
// Tracing, request logging, handled-error translation, scope lineage, declared
// authorization and audit, all over injected ports. Process-agnostic: nothing
// here reads a database, a session or an environment variable.
//
// The error vocabulary and the access-policy vocabulary live at
// `@langwatch/api`; the Hono service framework is `@langwatch/api/rest`.
// Neither is re-exported here.
// ---------------------------------------------------------------------------

export { TrpcRootDefinition, type TrpcRoot } from "./trpc-root.js";
export {
  appTrpcCustomPolicy,
  appTrpcNoPermissionPolicy,
  appTrpcPolicy,
  appTrpcPolicyAny,
  appTrpcServiceAuthorizedPolicy,
  createTrpcApiService,
  declaredPolicy,
  type AppTrpcPolicy,
  type AppTrpcPolicyMiddlewares,
  type TrpcApiMount,
  type TrpcApiPorts,
  type TrpcApiPublicMount,
  type TrpcApiPublicService,
  type TrpcApiService,
} from "./trpc-api-service.js";
export { auditScopeIds, deriveAuditTarget, isAuditLogExempt } from "./trpc-audit.js";
export { redactAuditArgs } from "./trpc-audit-redaction.js";
export {
  handleTrpcCallLogging,
  isSilencedCall,
  recordTrpcCall,
  resetSlowCallThrottle,
  resolveSlowCallBudgetMs,
} from "./trpc-call-logging.js";
export { callerTraceContext } from "./trpc-caller-trace.js";
export {
  createDeclaredAuthzMiddlewares,
  type TrpcDeclaredAuthzContext,
  type TrpcDeclaredAuthzMiddlewares,
  type TrpcDeclaredAuthzPorts,
  type TrpcDeclaredCheck,
  type TrpcDeclaredCheckParams,
  type TrpcOrganizationRole,
} from "./trpc-declared-authz.js";
export {
  createTrpcErrorFormatter,
  type TrpcErrorCausePayloadPort,
} from "./trpc-error-formatter.js";
export { TrpcFailureTraceIds, trpcFailureTraceIds } from "./trpc-failure-trace.js";
export {
  createIsPublicProcedure,
  createPermissionProcedureBuilder,
  type PendingPermissionProcedureBuilder,
  type TrpcCheckMiddleware,
  type TrpcPolicyChainMiddlewares,
} from "./trpc-permission-builder.js";
export type { TrpcPolicyContext } from "./trpc-policy-context.js";
export type {
  TrpcActor,
  TrpcActorPort,
  TrpcAuditEntry,
  TrpcAuditPort,
  TrpcAuthorizationDecisions,
  TrpcAuthorizationDenialPort,
  TrpcAuthorizationPort,
  TrpcCauseTranslationPort,
  TrpcErrorReportingPort,
  TrpcIdentityPort,
  TrpcRequestHeaders,
  TrpcRequestLike,
  TrpcResponseLike,
  TrpcTranslatedCause,
} from "./trpc-policy-ports.js";
export { createTrpcRuntimePolicy, type TrpcRuntimePolicyPorts } from "./trpc-runtime-policy.js";
export { createScopeLineageGuard } from "./trpc-scope-lineage.js";
