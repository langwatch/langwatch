/**
 * The one deployment fact a signed-out browser is allowed to ask for, over the
 * process's tRPC transport.
 *
 * The procedure name is transitional and kept for API compatibility: it once
 * served a bag of environment variables, and deployment configuration no
 * longer travels through it. What is left are two viewer decisions that cannot
 * be embedded in the bundle at build time — which sign-in mode the deployment
 * offers, and whether this viewer sees the operator entry in the sidebar.
 *
 * Mounted as a PROCEDURE, not a router: `publicEnv` is a single query at the
 * root of the app's tRPC surface, and moving it under a namespace would be a
 * client-visible rename.
 */
import type { AuthzDeclaration } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { AuthApp } from "#app/auth.app";

/**
 * Authenticated or not, plus the operator allow-list the deployment
 * configured. Both are read straight off the request context, exactly as this
 * procedure has always read them.
 */
export type PublicEnvTrpcContext = Readonly<{
  session: Readonly<{ user?: Readonly<{ email?: string | null }> | null }> | null;
  app: Readonly<{
    config: Readonly<{ opsSidebarEmails?: readonly string[] | undefined }>;
  }>;
}>;

type PublicEnvTrpcProcedures<
  TContext extends PublicEnvTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's unauthenticated procedure: the sign-in page has no session. */
  public: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** The process's policy chain for one access declaration. */
  policy(declaration: AuthzDeclaration): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

const PUBLIC_ENV_ACCESS: AuthzDeclaration = {
  kind: "no-permission",
  reason: "resolves sign-in mode and viewer UI visibility only; no tenant product data",
};

export class PublicEnvTrpcApi {
  /**
   * Returns the procedure itself rather than a router: the app mounts it at
   * `publicEnv` on the root, and its input parser stays permissive because
   * clients have historically sent whatever they had to hand.
   */
  static create<
    TContext extends PublicEnvTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(procedures: PublicEnvTrpcProcedures<TContext, TOptions, TRoot>, app: AuthApp) {
    const { public: publicProcedure, policy } = procedures;

    return policy(PUBLIC_ENV_ACCESS)(publicProcedure.input(z.object({}).passthrough())).query(
      async ({ ctx }) => ({
        NEXTAUTH_PROVIDER: await app.resolveAuthProvider(),
        SHOW_OPS_IN_MAIN_SIDEBAR: app.showsOperatorEntry(
          ctx.session?.user?.email,
          ctx.app.config.opsSidebarEmails,
        ),
      }),
    );
  }
}
