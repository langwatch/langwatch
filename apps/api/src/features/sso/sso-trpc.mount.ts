/**
 * Binds the feature's declared procedures to this process's execution path.
 * Both names arrive through the Enterprise API composition: an API-role process
 * may depend on that and on no Enterprise feature package below it.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import { ssoConnectionTrpcTransport, type SsoApi } from "@langwatch/enterprise-api";

/** The one slice of the process context the `ssoConnections.*` namespace reads. */
export interface SsoHostContext {
  app: Readonly<{ sso: SsoApi }>;
}

export function createSsoConnectionTrpcRouter<TContext extends SsoHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(ssoConnectionTrpcTransport, (ctx) => ctx.app.sso);
}
