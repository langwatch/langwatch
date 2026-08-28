/**
 * App-process transport mounts for the workflow vertical.
 *
 * Two surfaces, one feature. `workflow.*` is the workflow lifecycle — versions,
 * copies, publication, the archive cascade. `optimization.*` is the
 * optimization studio's own surface; its procedures are workflow procedures
 * too, and the name is the one its pages have always called.
 *
 * Behaviour for both is package-owned (`@langwatch/workflow-server`). This
 * supplies the process's root, authenticated procedure and policy chain, plus
 * the host reads and capabilities each transport takes as ports.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  WorkflowOptimizationTrpcApi,
  WorkflowTrpcApi,
  type WorkflowOptimizationTrpcContext,
  type WorkflowOptimizationTrpcPorts,
  type WorkflowTrpcContext,
  type WorkflowTrpcPorts,
} from "@langwatch/workflow-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `optimization.*` on the app process's tRPC root. */
export function createWorkflowOptimizationTrpcRouter<
  TContext extends WorkflowOptimizationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TVersion,
  TComponent,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<WorkflowOptimizationTrpcPorts<TVersion, TComponent>>,
) {
  return WorkflowOptimizationTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}

/** Mounts `workflow.*` on the app process's tRPC root. */
export function createWorkflowTrpcRouter<
  TContext extends WorkflowTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<WorkflowTrpcPorts>) {
  return WorkflowTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}
