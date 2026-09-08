/**
 * Binds the feature's declared procedures to this process's execution path.
 * Every `secrets.*` procedure is authenticated and carries a permission the
 * declaration names, so nothing is decided here.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { SecretApi } from "@langwatch/secret-contract";
import { secretTrpcTransport } from "@langwatch/secret-server";

/**
 * The one slice of the process context the `secrets` namespace reads.
 *
 * `secrets` is also the wire namespace the browser calls and the key tRPC
 * hashes into its query cache, so the two spellings are the same on purpose.
 */
export interface SecretHostContext {
  app: Readonly<{ secrets: SecretApi }>;
}

export function createSecretTrpcRouter<TContext extends SecretHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(secretTrpcTransport, (ctx) => ctx.app.secrets);
}
