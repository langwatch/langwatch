/**
 * Binds the feature's declared procedures to this process's execution path.
 * Every `codingAgents.*` procedure is project-scoped and carries the permission
 * the declaration names, so nothing is decided here.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import { codingAgentTrpcTransport, type CodingAgentApp } from "@langwatch/coding-agent-server";

/** The one slice of the process context this namespace reads. */
export interface CodingAgentHostContext {
  app: Readonly<{ codingAgentApp: CodingAgentApp }>;
}

/** Mounts `codingAgents.*` on the app process's tRPC root. */
export function createCodingAgentTrpcRouter<TContext extends CodingAgentHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(codingAgentTrpcTransport, (ctx) => ctx.app.codingAgentApp);
}
