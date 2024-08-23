import type { BaseComponent, Workflow } from "./dsl";

export type Event =
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
    };
