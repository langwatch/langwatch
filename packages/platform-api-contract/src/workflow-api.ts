import type { AnyTRPCRootTypes, TRPCBuiltRouter, TRPCQueryProcedure } from "@trpc/server";
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
 * Portable type map for workflow procedures still implemented by the legacy
 * application router. API-side conformance keeps this temporary seam honest.
 */
export type WorkflowApiRouter = TRPCBuiltRouter<
  AnyTRPCRootTypes,
  {
    workflow: {
      engineMode: Query<WorkflowApiEngineModeInput, WorkflowApiEngineModeOutput>;
      getById: Query<WorkflowApiGetByIdInput, WorkflowApiGetByIdOutput>;
      getVersions: Query<WorkflowApiGetVersionsInput, WorkflowApiGetVersionsOutput>;
    };
  }
>;
