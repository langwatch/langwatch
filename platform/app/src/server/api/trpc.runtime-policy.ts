/**
 * The app process's tRPC policy, composed.
 *
 * The middlewares themselves are `@langwatch/trpc`'s — tracing, request
 * logging, handled-error translation, the fail-closed permission backstop and
 * the audit trail are framework policy, not this application's. What is
 * decided here is everything portable code cannot decide: who the caller is,
 * where an audit row goes, which reporter an unhandled fault reaches, and
 * which of this application's typed causes become a bad request.
 */
import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import {
  createTrpcRuntimePolicy,
  type TrpcAuditPort,
  type TrpcCauseTranslationPort,
  type TrpcErrorReportingPort,
  type TrpcIdentityPort,
  type TrpcTranslatedCause,
} from "@langwatch/trpc";
import { TRPCError } from "@trpc/server";
import { auditLog } from "~/runtime/app/features/audit-log";
import { AiCallFailedError } from "~/server/modelProviders/aiCallFailedError";
import { ModelProviderDisabledError } from "~/server/modelProviders/modelProviderDisabledError";
import { captureException, toError } from "../../utils/posthogErrorCapture";
import type { Session } from "../auth";
import type { TRPCContext } from "./trpc.context";
import { appTrpcRoot } from "./trpc.root";

/**
 * What a resolver sees once the caller is known: the same session, with its
 * user proven non-null. ~800 procedures read `ctx.session.user`, so the shape
 * downstream stays this application's rather than the framework's.
 */
type AuthenticatedTrpcContext = { session: Session };

const identity: TrpcIdentityPort<TRPCContext, AuthenticatedTrpcContext> = {
  authenticate(ctx) {
    const session = ctx.session;
    if (!session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    // infers the `session` as non-nullable
    return { session: { ...session, user: session.user } };
  },
  actor(ctx) {
    const user = ctx.session?.user;
    // When an admin is impersonating, `user.id` is the impersonated user
    // (correct for RBAC attribution) and the impersonator is the real admin,
    // which is what the audit row stamps in metadata.
    return user ? { id: user.id, impersonatorId: user.impersonator?.id } : undefined;
  },
};

const audit: TrpcAuditPort = {
  record: (entry) => auditLog(entry),
};

const errorReporting: TrpcErrorReportingPort = {
  capture: (failure) => captureException(toError(failure)),
  asError: (failure) => toError(failure),
};

/**
 * The three typed model-provider causes this application re-raises with a code
 * of its own.
 *
 * All three become BAD_REQUEST so the error formatter serialises the cause
 * into `data.cause` and the frontend interceptor can open its modal or toast.
 * Left to fall through they arrive as INTERNAL_SERVER_ERROR: the missing-model
 * modal never opens, monitoring and retry policy read a user-actionable
 * configuration problem as a server fault, and the customer sees a bare
 * "something went wrong".
 */
const causes: TrpcCauseTranslationPort = {
  translate(cause): TrpcTranslatedCause | undefined {
    if (
      cause instanceof ModelNotConfiguredError ||
      cause instanceof AiCallFailedError ||
      cause instanceof ModelProviderDisabledError
    ) {
      return { code: "BAD_REQUEST", message: cause.message };
    }
    return undefined;
  },
};

const policy = createTrpcRuntimePolicy<TRPCContext, AuthenticatedTrpcContext>(appTrpcRoot, {
  identity,
  audit,
  errorReporting,
  causes,
});

export const {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  enforceUserIsAuthed,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} = policy;
