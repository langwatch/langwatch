import type { Component, BaseComponent, Workflow } from "./dsl";
import type { Node } from "@xyflow/react";

export type StudioClientEvent = {
  type: "execute_component";
  payload: {
    trace_id: string;
    node: Node<Component>;
    inputs: Record<string, string>;
  };
};

export type StudioServerEvent =
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
