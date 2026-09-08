/**
 * Binds the feature's declared procedures to this process's execution path.
 *
 * There are no ports: the answer comes from the AuthZ application the request
 * context already carries, so a second one here would be a second answer to
 * one question.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { AuthzApi } from "@langwatch/authz-contract";
import { authzTrpcTransport } from "@langwatch/authz-server";

/**
 * The one slice of the process context the `authz` namespace reads.
 *
 * `authz` is also the wire namespace the browser calls and the key tRPC hashes
 * into its query cache, so the two spellings are the same on purpose.
 */
export interface AuthzHostContext {
  app: Readonly<{ authzApp: AuthzApi }>;
}

/** Mounts `authz.*` on the app process's tRPC root. */
export function createAuthzTrpcRouter<TContext extends AuthzHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(authzTrpcTransport, (ctx) => ctx.app.authzApp);
}
