/**
 * Binds the one signed-out surface to this process's execution path. The
 * caller's address and their own address are the PROCESS's, so each arrives
 * as a fact rather than off a context.
 */
import { bindTrpcFact, callerAddressFact, type TrpcRuntime } from "@langwatch/api/trpc";
import type { AuthApi } from "@langwatch/auth-contract";
import { callerEmailFact, frontDoorTrpcTransport } from "@langwatch/auth-server";

/** The slice of the process context this surface reads. */
export interface AuthHostContext {
  clientIp?: () => string;
  session?: Readonly<{ user: Readonly<{ email?: string | null }> }> | null;
}

/** Mounts `frontDoor.*` under its own key at the root. */
export function createFrontDoorTrpcRouter<TContext extends AuthHostContext>(
  runtime: TrpcRuntime<TContext>,
  app: () => AuthApi,
) {
  return runtime.mount(frontDoorTrpcTransport, app, {
    facts: [
      bindTrpcFact(callerAddressFact, (ctx) => ctx.clientIp?.() ?? null),
      bindTrpcFact(callerEmailFact, (ctx) => ctx.session?.user.email ?? null),
    ],
  });
}
