import type { BaseComponent, Workflow } from "./dsl";

export type StudioClientEvent =
  | {
      type: "execute_component";
      payload: {
        component_ref: string;
      };
    };

export type StudioServerEvent =
  | {
      type: "component_state_change";
      payload: {
        component_ref: string;
        execution_state: BaseComponent["execution_state"];
        timestamps?: {
          started_at?: number;
          finished_at?: number;
        };
      };
    }
  | {
      type: "execution_state_change";
      payload: {
        execution_state: Workflow["state"]["execution"];
        timestamps?: {
          started_at?: number;
          finished_at?: number;
        };
      };
    }
  | {
      type: "debug";
      payload: {
        message: string;
      };
    };
