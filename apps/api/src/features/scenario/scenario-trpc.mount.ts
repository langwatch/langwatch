/**
 * App-process transport mount for the scenario vertical.
 *
 * Behaviour is package-owned (`@langwatch/scenario-server`); this supplies the
 * process's root, authenticated procedure, policy chain and the two
 * fire-and-forget process side effects a created scenario triggers.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  ScenarioTrpcApi,
  type ScenarioTrpcContext,
  type ScenarioTrpcPorts,
} from "@langwatch/scenario-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `scenarios.*` on the app process's tRPC root. */
export function createScenarioTrpcRouter<
  TContext extends ScenarioTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<ScenarioTrpcPorts>) {
  return ScenarioTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}
