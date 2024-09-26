import type { BaseComponent, Workflow } from "./dsl";

export type StudioClientEvent =
  | { type: "is_alive"; payload: Record<string, never> }
  | {
      type: "execute_component";
      payload: {
        trace_id: string;
        workflow: Workflow;
        node_id: string;
        inputs: Record<string, string>;
      };
    }
  | {
      type: "stop_execution";
      payload: {
        trace_id: string;
        node_id?: string;
      };
    }
  | {
      type: "execute_flow";
      payload: {
        trace_id: string;
        workflow: Workflow;
        until_node_id?: string;
      };
    }
  | {
      type: "execute_evaluation";
      payload: {
        run_id: string;
        workflow: Workflow;
        workflow_version_id: string;
        evaluate_on: "full" | "test" | "train";
      };
    }
  | {
      type: "stop_evaluation_execution";
      payload: {
        workflow: Workflow;
        run_id: string;
      };
    };

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
