import { workflowJsonSchema, type BaseComponent, type Workflow } from "./dsl";
import { optimizerParamsSchema, OPTIMIZERS } from "./optimizers";
import { z } from "zod";

export const studioClientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("is_alive"), payload: z.record(z.never()) }),
  z.object({
    type: z.literal("execute_component"),
    payload: z.object({
      trace_id: z.string(),
      workflow: workflowJsonSchema,
      node_id: z.string(),
      inputs: z.record(z.string()),
    }),
  }),
  z.object({
    type: z.literal("stop_execution"),
    payload: z.object({
      trace_id: z.string(),
      node_id: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("execute_flow"),
    payload: z.object({
      trace_id: z.string(),
      workflow: workflowJsonSchema,
      until_node_id: z.string().optional(),
      inputs: z.array(z.record(z.string())).optional(),
      manual_execution_mode: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("execute_evaluation"),
    payload: z.object({
      run_id: z.string(),
      workflow: workflowJsonSchema,
      workflow_version_id: z.string(),
      evaluate_on: z.enum(["full", "test", "train"]),
    }),
  }),
  z.object({
    type: z.literal("execute_optimization"),
    payload: z.object({
      run_id: z.string(),
      workflow: workflowJsonSchema,
      workflow_version_id: z.string(),
      optimizer: z.enum(Object.keys(OPTIMIZERS) as [keyof typeof OPTIMIZERS]),
      params: optimizerParamsSchema,
    }),
  }),
  z.object({
    type: z.literal("stop_evaluation_execution"),
    payload: z.object({
      workflow: workflowJsonSchema,
      run_id: z.string(),
    }),
  }),
  z.object({
    type: z.literal("stop_optimization_execution"),
    payload: z.object({
      workflow: workflowJsonSchema,
      run_id: z.string(),
    }),
  }),
]);

export type StudioClientEvent = z.infer<typeof studioClientEventSchema>;

export type StudioServerEvent =
  | {
      type: "is_alive_response";
    }
  | {
      type: "component_state_change";
      payload: {
        component_id: string;
        execution_state: BaseComponent["execution_state"];
      };
    }
  | {
      type: "execution_state_change";
      payload: {
        execution_state: Workflow["state"]["execution"];
      };
    }
  | {
      type: "evaluation_state_change";
      payload: {
        evaluation_state: Workflow["state"]["evaluation"];
      };
    }
  | {
      type: "optimization_state_change";
      payload: {
        optimization_state: Workflow["state"]["optimization"];
      };
    }
  | {
      type: "debug";
      payload: {
        message: string;
      };
    }
  | {
      type: "error";
      payload: {
        message: string;
      };
    }
  | {
      type: "done";
    };
