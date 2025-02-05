/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import {
  initTRPC,
  TRPCError,
  type ProcedureBuilder,
  type ProcedureParams,
  type Simplify,
} from "@trpc/server";
import { type CreateNextContextOptions } from "@trpc/server/adapters/next";
import type { inferParser, Parser } from "@trpc/server/dist/core/parser";
import type { NextApiRequest, NextApiResponse } from "next";
import { type Session } from "next-auth";
import superjson from "superjson";
import { ZodError } from "zod";

import type { UnsetMarker } from "@trpc/server/dist/core/internals/utils";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { auditLog } from "../auditLog";
import {
  permissionGuardedString,
  type PermissionMiddleware,
} from "./permission";

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
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
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
  }
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
  }
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
    schema: $Parser
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
    middleware: PermissionMiddleware<TParams["_input_out"]>
  ) => ReturnType<ProcedureBuilder<TParams>["use"]>;
}

const markProjectId = t.middleware(({ next, input }) => {
  const input_ = input as any;
  if (input_.projectId) {
    input_.projectId = permissionGuardedString(input_.projectId, false);
  }
  if (input_.teamId) {
    input_.teamId = permissionGuardedString(input_.teamId, false);
  }
  if (input_.organizationId) {
    input_.organizationId = permissionGuardedString(
      input_.organizationId,
      false
    );
  }
  return next();
});

const permissionProcedureBuilder = <TParams extends ProcedureParams>(
  procedure: ProcedureBuilder<TParams>
): PendingPermissionProcedureBuilder<TParams> => {
  return {
    input: (input) => {
      return permissionProcedureBuilder(
        procedure.input(input as any).use(markProjectId as any) as any
      );
    },
    use: (middleware) => {
      return procedure
        .use(middleware as any)
        .use(enforcePermissionCheck as any)
        .use(auditLogMutations as any) as any;
    },
  };
};

export const protectedProcedure = permissionProcedureBuilder(
  authProtectedProcedure
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
