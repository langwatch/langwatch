/**
 * App-process transport mount for the evaluation vertical.
 *
 * Behaviour is package-owned (`@langwatch/evaluation-server`); this supplies
 * the process's root, authenticated procedure, policy chain, the client the
 * custom-evaluator read runs on, and the application ports the evaluation
 * package does not own.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  EvaluationTrpcApi,
  type EvaluationTrpcContext,
  type EvaluationTrpcPorts,
} from "@langwatch/evaluation-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";
import { listCustomEvaluators } from "./custom-evaluators";

/**
 * The application ports this mount forwards untouched. Each reaches a
 * capability the evaluation package does not own: the trace-mapping registry,
 * the project's Azure Safety credentials, this install's evaluator inventory
 * and environment, the trace evaluation runner, product analytics, and the
 * evaluator runtime's keep-alive probe. `listCustomEvaluators` is absent
 * because this mount builds it from the client below.
 */
export type EvaluationMountPorts<TMappingsIn, TMappingsOut> = Omit<
  EvaluationTrpcPorts<TMappingsIn, TMappingsOut, never>,
  "listCustomEvaluators"
>;

/** The client the custom-evaluator read runs on. */
type EvaluationMountClient = Readonly<{ prisma: PrismaClient }>;

/** Mounts `evaluations.*` on the app process's tRPC root. */
export function createEvaluationTrpcRouter<
  TContext extends EvaluationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TMappingsIn,
  TMappingsOut,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    EvaluationMountClient &
    TrpcApiPorts<EvaluationMountPorts<TMappingsIn, TMappingsOut>>,
) {
  return EvaluationTrpcApi.create(mount.root, createTrpcApiService(mount), {
    ...mount.ports,
    listCustomEvaluators: ({ projectId }) =>
      listCustomEvaluators({ prisma: mount.prisma, projectId }),
  });
}
