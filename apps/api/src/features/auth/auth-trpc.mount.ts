/**
 * Binds the two signed-out surfaces to this process's execution path. The
 * caller's address, their own address and the operator allow-list are the
 * PROCESS's, so each arrives as a fact rather than off a context.
 */
import { bindTrpcFact, callerAddressFact, type TrpcRuntime } from "@langwatch/api/trpc";
import {
  callerEmailFact,
  frontDoorTrpcTransport,
  operatorAllowListFact,
  publicEnvTrpcTransport,
  viewerEmailFact,
  type FrontDoorApi,
  type PublicEnvApi,
} from "@langwatch/auth-server";

/** The slice of the process context these two surfaces read. */
export interface AuthHostContext {
  app: Readonly<{
    config: Readonly<{ opsSidebarEmails?: readonly string[] | undefined }>;
  }>;
  clientIp?: () => string;
  session?: Readonly<{ user: Readonly<{ email?: string | null }> }> | null;
}

/** Mounts `frontDoor.*` under its own key at the root. */
export function createFrontDoorTrpcRouter<TContext extends AuthHostContext>(
  runtime: TrpcRuntime<TContext>,
  app: () => FrontDoorApi,
) {
  return runtime.mount(frontDoorTrpcTransport, app, {
    facts: [
      bindTrpcFact(callerAddressFact, (ctx) => ctx.clientIp?.() ?? null),
      bindTrpcFact(callerEmailFact, (ctx) => ctx.session?.user.email ?? null),
    ],
  });
}

/**
 * Mounts `publicEnv` and answers the PROCEDURE rather than the router around
 * it. A single query at the ROOT rather than a namespace: the client calls
 * `publicEnv({})`, and a key of its own would rename it.
 */
export function createPublicEnvTrpcProcedure<TContext extends AuthHostContext>(
  runtime: TrpcRuntime<TContext>,
  app: () => PublicEnvApi,
) {
  const mounted = runtime.mount(publicEnvTrpcTransport, app, {
    facts: [
      bindTrpcFact(viewerEmailFact, (ctx) => ctx.session?.user.email ?? null),
      bindTrpcFact(operatorAllowListFact, (ctx) => {
        const allowList = ctx.app.config.opsSidebarEmails;

        return allowList ? [...allowList] : null;
      }),
    ],
  });

  return mounted.publicEnv;
}
