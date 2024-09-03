import type { Component, BaseComponent, Workflow } from "./dsl";
import type { Node } from "@xyflow/react";

export type StudioClientEvent =
  | { type: "is_alive"; payload: Record<string, never> }
  | {
      type: "execute_component";
      payload: {
        trace_id: string;
        node: Node<Component>;
        inputs: Record<string, string>;
      };
    }
  | {
      type: "stop_execution";
      payload: {
        trace_id: string;
        node_id?: string;
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
