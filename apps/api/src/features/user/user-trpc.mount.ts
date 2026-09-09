/**
 * Binds the user vertical's declared procedures to this process's execution
 * path. Both namespaces act on the SESSION's own account, so both bind the
 * same `UserApi` and neither takes a narrow door of its own.
 */
import { bindTrpcFact, browserSessionFact, callerAddressFact, type TrpcRuntime } from "@langwatch/api/trpc";
import type { UserApi } from "@langwatch/user-contract";
import { identityTrpcTransport, userTrpcTransport } from "@langwatch/user-server";

/** The slice of the process context these two namespaces read. */
export interface UserHostContext {
  app: Readonly<{ users: UserApi }>;
  clientIp?: () => string;
  session?: Readonly<{ sessionId?: string | undefined }> | null;
}

/**
 * Mounts `user.*`. The caller's address keys the sign-up throttle and the
 * browser session is what a credential write keeps alive, and neither is the
 * feature's to read off a context it cannot see.
 */
export function createUserTrpcRouter<TContext extends UserHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(userTrpcTransport, (ctx) => ctx.app.users, {
    facts: [
      bindTrpcFact(callerAddressFact, (ctx) => ctx.clientIp?.() ?? null),
      bindTrpcFact(browserSessionFact, (ctx) => ctx.session?.sessionId ?? null),
    ],
  });
}

/** Mounts `identity.*`: the ceremony that spends a magic link. */
export function createIdentityTrpcRouter<TContext extends UserHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(identityTrpcTransport, (ctx) => ctx.app.users);
}
