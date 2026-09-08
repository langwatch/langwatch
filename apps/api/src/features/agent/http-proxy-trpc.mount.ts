import { httpProxyTrpcTransport } from "@langwatch/agent-server";
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { AgentTrpcContext } from "./agent-trpc.mount.ts";

// Keep httpProxy.execute: the audit policy uses this path to redact test credentials.
export function createHttpProxyTrpcRouter<TContext extends AgentTrpcContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(httpProxyTrpcTransport, (ctx) => ctx.app.agents);
}
