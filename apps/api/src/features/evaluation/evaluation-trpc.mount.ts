/**
 * App-process transport mount for the evaluation vertical.
 *
 * Behaviour is package-owned (`@langwatch/evaluation-server`); this supplies
 * the process's root, authenticated procedure, policy chain, the client the
 * custom-evaluator read runs on, and the application ports the evaluation
 * package does not own.
 */
import {
  EvaluationTrpcApi,
  type EvaluationTrpcContext,
  type EvaluationTrpcPorts,
} from "@langwatch/evaluation-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { appTrpcPolicy, type AppTrpcPolicyMiddlewares } from "../../app-trpc/app-trpc.policy";
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

type EvaluationMount<
  TContext extends EvaluationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TMappingsIn,
  TMappingsOut,
> = Readonly<{
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
  /** The client the custom-evaluator read runs on. */
  prisma: PrismaClient;
  ports: EvaluationMountPorts<TMappingsIn, TMappingsOut>;
}>;

/** Mounts `evaluations.*` on the app process's tRPC root. */
export function createEvaluationTrpcRouter<
  TContext extends EvaluationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TMappingsIn,
  TMappingsOut,
>(mount: EvaluationMount<TContext, TOptions, TRoot, TMappingsIn, TMappingsOut>) {
  return EvaluationTrpcApi.create(
    mount.root,
    { protected: mount.protectedProcedure, policy: appTrpcPolicy(mount.middlewares) },
    {
      ...mount.ports,
      listCustomEvaluators: ({ projectId }) =>
        listCustomEvaluators({ prisma: mount.prisma, projectId }),
    },
  );
}
