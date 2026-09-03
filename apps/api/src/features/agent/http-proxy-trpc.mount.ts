/**
 * App-process transport mount for the HTTP agent test button.
 *
 * Behaviour is package-owned (`@langwatch/agent-server`); this supplies the
 * process's root, authenticated procedure, policy chain and the two ports the
 * agent package does not own — dispatching a node to the workflow engine, and
 * ingesting the span the test writes.
 *
 * The procedure keeps the action path `httpProxy.execute`. That path is a key
 * in the audit redaction table, which is what drops the `templateVariables`
 * values before an audit row is written — a person types a test token into
 * them. Renaming the mount point would silently stop the redaction applying.
 */
import {
  HttpProxyTrpcApi,
  type HttpProxyTrpcContext,
  type HttpProxyTrpcPorts,
} from "@langwatch/agent-server";
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `httpProxy.*` on the app process's tRPC root. */
export function createHttpProxyTrpcRouter<
  TContext extends HttpProxyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<HttpProxyTrpcPorts>) {
  return HttpProxyTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}
