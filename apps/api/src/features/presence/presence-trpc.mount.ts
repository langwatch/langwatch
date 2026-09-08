/**
 * Binds the feature's declared procedures to this process's execution path.
 * Two of the five are subscriptions, whose lane resolves a path on the caller
 * built from the process's root: a namespace mounted outside the feature
 * record would be callable and un-watchable.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { PresenceApi } from "@langwatch/presence-contract";
import { presenceTrpcTransport } from "@langwatch/presence-server";

/** The one slice of the process context this namespace reads. */
export interface PresenceHostContext {
  app: Readonly<{ presence: PresenceApi }>;
}

/**
 * Mounts `presence.*` on this process's root, over the `ctx.app.presence`
 * slice the composition put there.
 */
export function createPresenceTrpcRouter<TContext extends PresenceHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(presenceTrpcTransport, (ctx) => ctx.app.presence);
}
