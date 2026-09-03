/**
 * App-process transport mount for the coding-agent read vertical (ADR-056).
 *
 * Behaviour is package-owned (`@langwatch/coding-agent-server`); this supplies
 * the process's root, authenticated procedure, policy chain and the ports the
 * coding-agent package does not own — which organization a project belongs to,
 * the caller's permission cut over it, and what one viewer may see of one
 * project.
 */
import {
  CodingAgentTrpcApi,
  type CodingAgentTrpcContext,
  type CodingAgentTrpcPorts,
} from "@langwatch/coding-agent-server";
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `codingAgents.*` on the app process's tRPC root. */
export function createCodingAgentTrpcRouter<
  TContext extends CodingAgentTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<CodingAgentTrpcPorts>) {
  return CodingAgentTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}
