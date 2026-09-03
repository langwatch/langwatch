import type {
  TRPCBuiltRouter,
  TRPCDefaultErrorShape,
  TRPCQueryProcedure,
} from "@trpc/server";
import {
  type WorkflowVersionHistoryEntry,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import { z } from "zod";

export const workflowApiEngineModeInputSchema = z.object({
  projectId: z.string(),
});

export const workflowApiGetByIdInputSchema = z.object({
  projectId: z.string(),
  workflowId: z.string(),
});

export const workflowApiGetVersionsInputSchema = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  returnDSL: z.union([z.boolean(), z.literal("previousVersion")]).optional(),
});

export type WorkflowApiEngineModeInput = z.infer<typeof workflowApiEngineModeInputSchema>;
export type WorkflowApiGetByIdInput = z.infer<typeof workflowApiGetByIdInputSchema>;
export type WorkflowApiGetVersionsInput = z.infer<
  typeof workflowApiGetVersionsInputSchema
>;

export type WorkflowApiEngineModeOutput = {
  engineMode: "go";
  optimizeEnabled: false;
};

export type WorkflowApiGetByIdOutput = WorkflowWithVersion;
export type WorkflowApiGetVersionsOutput = WorkflowVersionHistoryEntry[];

type Query<TInput, TOutput> = TRPCQueryProcedure<{
  input: TInput;
  output: TOutput;
  meta: unknown;
}>;

/**
 * The root types the clients of this router actually run with.
 *
 * `AnyTRPCRootTypes` leaves `transformer` as `any`, and tRPC's output
 * inference branches on it — so `any extends false` takes both branches and
 * every procedure's output came back as `Serialize<T> | T`. A `Date` reached
 * the caller as `string | Date` and nothing could read it as the `Date` it is.
 * Every client of this router goes through the app's superjson transport, so
 * the transformer is pinned here rather than left unknown.
 */
type WorkflowApiRootTypes = {
  ctx: object;
  meta: object;
  errorShape: TRPCDefaultErrorShape;
  transformer: true;
};

/**
 * Portable type map for workflow procedures still implemented by the legacy
 * application router. API-side conformance keeps this temporary seam honest.
 */
export type WorkflowApiRouter = TRPCBuiltRouter<
  WorkflowApiRootTypes,
  {
    workflow: {
      engineMode: Query<WorkflowApiEngineModeInput, WorkflowApiEngineModeOutput>;
      getById: Query<WorkflowApiGetByIdInput, WorkflowApiGetByIdOutput>;
      getVersions: Query<WorkflowApiGetVersionsInput, WorkflowApiGetVersionsOutput>;
    };
  }
>;
