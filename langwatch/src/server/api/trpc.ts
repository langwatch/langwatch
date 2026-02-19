/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import type { inferParser } from "@trpc/server";
import {
  initTRPC,
  type ProcedureBuilder,
  type ProcedureParams,
  type Simplify,
  TRPCError,
} from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import type { CreateNextContextOptions } from "@trpc/server/adapters/next";
import type { Parser } from "@trpc-internal/parser";
import type { UnsetMarker } from "@trpc-internal/utils";
import type { NextApiRequest, NextApiResponse } from "next";
import type { Session } from "next-auth";
import superjson from "superjson";
import { ZodError } from "zod";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { DomainError } from "~/server/app-layer/domain-error";
import { getLogLevelFromStatusCode } from "../middleware/requestLogging";
import { createLogger } from "../../utils/logger/server";
import { captureException } from "../../utils/posthogErrorCapture";
import { auditLog } from "../auditLog";
import type { PermissionMiddleware } from "./rbac";

const logger = createLogger("langwatch:trpc");

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 */

interface CreateContextOptions {
  req?: NextApiRequest;
  res?: NextApiResponse;
  session: Session | null;
  permissionChecked?: boolean;
  publiclyShared?: boolean;
}

/**
 * This helper generates the "internals" for a tRPC context. If you need to use it, you can export
 * it from here.
 *
 * Examples of things you may need it for:
 * - testing, so we don't have to mock Next.js' req/res
 * - tRPC's `createSSGHelpers`, where we don't have req/res
 *
 * @see https://create.t3.gg/en/usage/trpc#-serverapitrpcts
 */
export const createInnerTRPCContext = (opts: CreateContextOptions) => {
  return {
    session: opts.session,
    req: opts.req,
    res: opts.res,
    prisma,
    permissionChecked: opts.permissionChecked ?? false,
    publiclyShared: opts.publiclyShared ?? false,
  };
};

/**
 * This is the actual context you will use in your router. It will be used to process every request
 * that goes through your tRPC endpoint.
 *
 * @see https://trpc.io/docs/context
 */
export const createTRPCContext = async (opts: CreateNextContextOptions) => {
  const { req, res } = opts;

  // Get the session from the server using the getServerSession wrapper function
  const session = await getServerAuthSession({ req, res });

  return createInnerTRPCContext({
    req,
    res,
    session,
    permissionChecked: false,
    publiclyShared: false,
  });
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Extract limit info if present in cause
    const cause = error.cause as
      | { limitType?: string; current?: number; max?: number }
      | undefined;
    const limitInfo = cause?.limitType
      ? {
          limitType: cause.limitType,
          current: cause.current,
          max: cause.max,
        }
      : null;

    const domainError =
      error.cause instanceof DomainError ? error.cause.serialize() : null;

    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
        cause: limitInfo,
        domainError,
      },
    };
  },
});

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/** Reusable middleware that enforces users are logged in before running the procedure. */
const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      // infers the `session` as non-nullable
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

const enforcePermissionCheck = t.middleware(({ ctx, next }) => {
  if (!ctx.permissionChecked) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Permission check is required",
    });
  }
  return next();
});

const auditLogTRPCErrors = t.middleware(
  async ({ ctx, next, path, type, input }) => {
    const result = await next();
    if (
      (type !== "mutation" || !ctx.permissionChecked) && // avoid duplicated audit logs for mutations
      !result.ok &&
      result.error instanceof TRPCError &&
      result.error.code !== "INTERNAL_SERVER_ERROR" &&
      ctx.session?.user.id
    ) {
      await auditLog({
        userId: ctx.session.user.id,
        organizationId: (input as any)?.organizationId,
        projectId: (input as any)?.projectId,
        action: path,
        args: input,
        error: result.error,
        req: ctx.req,
      });
    }

    return result;
  },
);

const auditLogMutations = t.middleware(
  async ({ ctx, next, type, path, input }) => {
    if (
      type !== "mutation" ||
      !ctx.session?.user ||
      path === "user.updateLastLogin"
    ) {
      return next();
    }

    let result = await next();

    await auditLog({
      userId: ctx.session.user.id,
      organizationId: (input as any)?.organizationId,
      projectId: (input as any)?.projectId,
      action: path,
      args: input,
      error: !result.ok ? result.error : undefined,
      req: ctx.req,
    });

    return result;
  },
);

export const tracerMiddleware = t.middleware(
  async ({ path, type, next }) => {
    const { trace, SpanKind, SpanStatusCode } = await import(
      "@opentelemetry/api"
    );

    const tracer = trace.getTracer("langwatch:trpc");
    const spanName = `trpc.${path}`;

    return tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "rpc.system": "trpc",
          "rpc.method": path,
          "rpc.type": type,
        },
      },
      async (span) => {
        // IMPORTANT: In tRPC v10, next() never throws. Downstream errors are
        // returned as { ok: false, error } result objects — NOT thrown.
        const result = await next();

        if (!result.ok) {
          const err = result.error;
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
        }

        span.end();
        return result;
      },
    );
  },
);

function domainErrorToTRPCCode(
  error: DomainError,
): TRPCError["code"] {
  const map: Partial<Record<number, TRPCError["code"]>> = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "UNPROCESSABLE_CONTENT",
    429: "TOO_MANY_REQUESTS",
  };
  return map[error.httpStatus] ?? "INTERNAL_SERVER_ERROR";
}

/**
 * Converts DomainErrors thrown in procedures to properly-coded TRPCErrors.
 * Without this, DomainErrors fall through as INTERNAL_SERVER_ERROR.
 * Placed inner to loggerMiddleware so the logger sees the correct code.
 */
const domainErrorMiddleware = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof DomainError) {
    const domainError = result.error.cause;
    throw new TRPCError({
      code: domainErrorToTRPCCode(domainError),
      message: domainError.message,
      cause: domainError,
    });
  }
  return result;
});

/** Processes a tRPC call result and logs accordingly. Extracted for testability. */
export function handleTrpcCallLogging({
  result,
  path,
  type,
  duration,
  userAgent,
  statusCode,
  log,
  capture,
}: {
  result: { ok: boolean; error?: unknown };
  path: string;
  type: string;
  duration: number;
  userAgent: string | null;
  statusCode: number | null;
  log: Pick<ReturnType<typeof createLogger>, "info" | "warn" | "error">;
  capture: (error: unknown) => void;
}): void {
  const logData: Record<string, any> = {
    path,
    type,
    duration,
    userAgent,
    statusCode,
  };

  if (!result.ok) {
    logData.error = result.error;

    // Derive HTTP status from the TRPCError code, not ctx.res.statusCode.
    // The response status hasn't been set yet at middleware time — tRPC sets
    // it later when serializing the response. So we map it ourselves.
    const resolvedStatus =
      result.error instanceof TRPCError
        ? getHTTPStatusCodeFromError(result.error)
        : 500;
    logData.statusCode = resolvedStatus;

    // Include domain error kind in log data for structured filtering
    if (result.error instanceof TRPCError && result.error.cause instanceof DomainError) {
      logData.domainErrorKind = result.error.cause.kind;
    }

    // Only capture 5xx errors (actual bugs)
    if (resolvedStatus >= 500) {
      capture(result.error);
    }

    const logLevel = getLogLevelFromStatusCode(resolvedStatus);
    log[logLevel](logData, "trpc call");
  } else {
    log.info(logData, "trpc call");
  }
}

export const loggerMiddleware = t.middleware(
  async ({ path, type, input, ctx, next }) => {
    // Import context utilities dynamically to avoid circular deps
    const { createContextFromTRPC, runWithContext } =
      await import("../context/asyncContext");

    // Create context from tRPC context and input
    const requestContext = createContextFromTRPC(ctx, input as any);

    return runWithContext(requestContext, async () => {
      const start = Date.now();
      // IMPORTANT: In tRPC v10, next() never throws. Downstream errors are
      // caught by callRecursive and returned as { ok: false, error } result
      // objects. Use result.ok to detect errors — NOT try/catch.
      const result = await next();
      const duration = Date.now() - start;

      handleTrpcCallLogging({
        result,
        path,
        type,
        duration,
        userAgent: ctx.req?.headers["user-agent"] ?? null,
        statusCode: ctx.res?.statusCode ?? null,
        log: logger,
        capture: captureException,
      });

      return result;
    });
  },
);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
const authProtectedProcedure = t.procedure
  .use(enforceUserIsAuthed)
  .use(auditLogTRPCErrors);

type OverwriteIfDefined<TType, TWith> = UnsetMarker extends TType
  ? TWith
  : Simplify<TType & TWith>;

/**
 * Typescript hackery to make sure all endpoints are forced to set the input, then to explicitly tell
 * a permission check middleware to use, and that this permission check should be compatible with the
 * inputs required
 */
interface PendingPermissionProcedureBuilder<TParams extends ProcedureParams> {
  // Copy-paste from @trpc core internals procedureBuilder
  input: <$Parser extends Parser>(
    schema: $Parser,
  ) => PendingPermissionProcedureBuilder<{
    _config: TParams["_config"];
    _meta: TParams["_meta"];
    _ctx_out: TParams["_ctx_out"];
    _input_in: OverwriteIfDefined<
      TParams["_input_in"],
      inferParser<$Parser>["in"]
    >;
    _input_out: OverwriteIfDefined<
      TParams["_input_out"],
      inferParser<$Parser>["out"]
    >;

    _output_in: TParams["_output_in"];
    _output_out: TParams["_output_out"];
  }>;
  use: (
    middleware: PermissionMiddleware<TParams["_input_out"]>,
  ) => ReturnType<ProcedureBuilder<TParams>["use"]>;
}

const permissionProcedureBuilder = <TParams extends ProcedureParams>(
  procedure: ProcedureBuilder<TParams>,
): PendingPermissionProcedureBuilder<TParams> => {
  return {
    input: (input) => {
      return permissionProcedureBuilder(procedure.input(input as any));
    },
    use: (middleware) => {
      return procedure
        .use(tracerMiddleware as any)
        .use(loggerMiddleware as any)
        .use(domainErrorMiddleware as any)
        .use(middleware as any)
        .use(enforcePermissionCheck as any)
        .use(auditLogMutations as any) as any;
    },
  };
};

export const protectedProcedure = permissionProcedureBuilder(
  authProtectedProcedure,
);

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 *
 */
export const publicProcedure = permissionProcedureBuilder(t.procedure);
