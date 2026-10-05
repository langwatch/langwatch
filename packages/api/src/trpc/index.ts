// @langwatch/api/trpc -- the typed tRPC root, the one execution path a declared
// procedure runs, and the policy spine a process builds its `procedure` from.
// Runtime dependencies remain injected; the framework and error vocabularies are
// exported from their own entrypoints.

export {
  composeTrpcRouters,
  type ComposableTrpcRouter,
  type ComposedTrpcContract,
} from "./compose.ts";

export {
  bindTrpcFact,
  bindTrpcHeader,
  browserSessionFact,
  callerAddressFact,
  createTrpcErrorFormatter,
  createTrpcHandlerBinding,
  createTrpcRuntime,
  defineTrpcFact,
  defineTrpcRouter,
  parseGovernedOutput,
  resolveTrustedHandlerArguments,
  TrpcHandlerBinding,
  TrpcRootDefinition,
  type ApiHandlerAdapter,
  type TrpcAccess,
  type TrpcAnonymousHandlerArguments,
  type TrpcBuildableProcedure,
  type TrpcContractHandlerArguments,
  type TrpcContractProcedures,
  type TrpcErrorCausePayload,
  type TrpcFact,
  type TrpcFactBinding,
  type TrpcFeatureApiWitness,
  type TrpcHandlerActor,
  type TrpcMountOptions,
  type TrpcProceduresNotImplemented,
  type TrpcProcedureFactory,
  type TrpcProcedureRequest,
  type TrpcRoot,
  type TrpcRouterAccess,
  type TrpcRouterBuilder,
  type TrpcRouterDeclaration,
  type TrpcRouterImplementation,
  type TrpcRouterMount,
  type TrpcRuntime,
  type TrpcAuditedScope,
  type TrpcAuditTarget,
  type TrpcRuntimeAuditEntry,
  type TrpcRuntimeContext,
  type TrpcRuntimeMembers,
  type TrpcRuntimeRequest,
} from "./runtime.ts";

export {
  auditScopeIds,
  callerTraceContext,
  deriveAuditTarget,
  handleTrpcCallLogging,
  isAuditLogExempt,
  isSilencedCall,
  recordTrpcCall,
  redactAuditArgs,
  resetSlowCallThrottle,
  resolveSlowCallBudgetMs,
  TrpcFailureTraceIds,
  trpcFailureTraceIds,
} from "./audit.ts";

export {
  trpcThrottle,
  type TrpcThrottle,
  type TrpcThrottleDecision,
  type TrpcThrottlePolicy,
} from "./throttle.ts";

export {
  createDeclaredAuthzMiddlewares,
  createIsPublicProcedure,
  createScopeLineageGuard,
  createTrpcRuntimePolicy,
  type TrpcActor,
  type TrpcActorReader,
  type TrpcAuditEntry,
  type TrpcAudit,
  type TrpcAuthenticatedMiddlewareContext,
  type TrpcAuthorizationDenial,
  type TrpcAuthorization,
  type TrpcCauseTranslation,
  type TrpcContextOnlyCheckParams,
  type TrpcContextOnlyDeclaredCheck,
  type TrpcDeclaredAuthzContext,
  type TrpcDeclaredAuthzMiddlewares,
  type TrpcDeclaredAuthzMembers,
  type TrpcDeclaredCheck,
  type TrpcDeclaredCheckParams,
  type TrpcErrorReporting,
  type TrpcIdentity,
  type TrpcMiddlewareContext,
  type TrpcOrganizationRole,
  type TrpcPolicyContext,
  type TrpcRequestHeaders,
  type TrpcRequestLike,
  type TrpcResponseLike,
  type TrpcRuntimePolicyMembers,
  type TrpcTranslatedCause,
} from "./policy.ts";

export type { ApiHandlerArguments } from "../handler-arguments.ts";

// Where every declared namespace mounts, and the subscription lane over the
// same composed router.
export {
  TrpcHost,
  type TrpcNamespace,
  type TrpcRequestContext,
  type TrpcSession,
  type TrpcSessionUser,
} from "./host.ts";
export { SseLane } from "./sse.ts";

// Named by every router's inferred type, so a module's declaration emit can name them.
export type {
  ApiEntitlement,
  EntitlementOptions,
  PlatformPermissionTarget,
} from "../access/access.ts";
export type {
  ExactInputPermission,
  InputPermission,
  PermissionChoice,
  PermissionMap,
} from "../access/input-permission.ts";
