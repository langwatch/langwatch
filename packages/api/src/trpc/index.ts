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

export { TrpcRootDefinition, type TrpcRoot } from "./trpc-root.ts";
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
} from "./trpc-api-service.ts";
export { auditScopeIds, deriveAuditTarget, isAuditLogExempt } from "./trpc-audit.ts";
export { redactAuditArgs } from "./trpc-audit-redaction.ts";
export {
  handleTrpcCallLogging,
  isSilencedCall,
  recordTrpcCall,
  resetSlowCallThrottle,
  resolveSlowCallBudgetMs,
} from "./trpc-call-logging.ts";
export { callerTraceContext } from "./trpc-caller-trace.ts";
export {
  createDeclaredAuthzMiddlewares,
  type TrpcContextOnlyCheckParams,
  type TrpcContextOnlyDeclaredCheck,
  type TrpcDeclaredAuthzContext,
  type TrpcDeclaredAuthzMiddlewares,
  type TrpcDeclaredAuthzPorts,
  type TrpcDeclaredCheck,
  type TrpcDeclaredCheckParams,
  type TrpcOrganizationRole,
} from "./trpc-declared-authz.ts";
export {
  createTrpcErrorFormatter,
  type TrpcErrorCausePayloadPort,
} from "./trpc-error-formatter.ts";
export { TrpcFailureTraceIds, trpcFailureTraceIds } from "./trpc-failure-trace.ts";
export {
  createIsPublicProcedure,
  createPermissionProcedureBuilder,
  type PendingPermissionProcedureBuilder,
  type TrpcCheckMiddleware,
  type TrpcPolicyChainMiddlewares,
} from "./trpc-permission-builder.ts";
export type { TrpcPolicyContext } from "./trpc-policy-context.ts";
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
} from "./trpc-policy-ports.ts";
export {
  createTrpcProcedure,
  createTrpcService,
  type TrpcBareProcedure,
  type TrpcDeclaredAbsent,
  type TrpcPolicyDecorator,
  type TrpcProcedureChain,
  type TrpcProcedureConfig,
  type TrpcService,
  type TrpcServiceConfig,
  type TrpcServiceProcedures,
  type TrpcUndeclared,
} from "./trpc-service-builder.ts";
export { createTrpcRuntimePolicy, type TrpcRuntimePolicyPorts } from "./trpc-runtime-policy.ts";
export { createScopeLineageGuard } from "./trpc-scope-lineage.ts";
export { trpcApi, type TrpcApiDescriptor } from "./trpc-api.ts";
