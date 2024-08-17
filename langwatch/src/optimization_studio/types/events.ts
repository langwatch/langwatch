type Event =
  | {
      type: "component_state_change";
      payload: {
        component_ref: string;
        state: ComponentState;
        error?: string;
        trace_id?: string;
        span_id?: string;
        inputs?: Record<string, string>;
        outputs?: Record<string, string>;
        timestamps?: {
          started_at?: number;
          finished_at?: number;
        };
      };
    }
  | {
      type: "execution_state_change";
      payload: {
        state: ExecutionState;
        error?: string;
        trace_id?: string;
        outputs?: Record<string, Record<string, string>>;
        timestamps?: {
          started_at?: number;
          finished_at?: number;
        };
      };
    };
