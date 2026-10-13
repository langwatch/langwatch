import {
  AbstractFoldProjection,
  type FoldEventHandlers,
  type FoldProjectionStore,
} from "@langwatch/eventing";

import type { ExperimentRunPlanFoldState } from "../repositories/experiment-run-fold.repository.ts";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../rules/experiment-run-event-types.rules.ts";
import {
  type ExperimentRunStartedEvent,
  experimentRunStartedEventSchema,
} from "./experiment-run-events.process.ts";

const experimentRunPlanEvents = [experimentRunStartedEventSchema] as const;

type TimestampKeys = "CreatedAt" | "UpdatedAt" | "LastEventOccurredAt";

/**
 * The plan a run's `started` carried, kept once so every cell reads its row, target and
 * evaluators from it (ARCHITECTURE §9, D4). It folds one event, so it is written once.
 */
export class ExperimentRunPlanFoldProjection
  extends AbstractFoldProjection<ExperimentRunPlanFoldState, typeof experimentRunPlanEvents>
  implements FoldEventHandlers<typeof experimentRunPlanEvents, ExperimentRunPlanFoldState>
{
  readonly name = "experimentRunPlan";
  readonly version = EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_PROGRESS;
  readonly store: FoldProjectionStore<ExperimentRunPlanFoldState>;
  readonly options = { refoldOnOutOfOrder: false } as const;

  protected readonly events = experimentRunPlanEvents;

  static create(deps: {
    store: FoldProjectionStore<ExperimentRunPlanFoldState>;
  }): ExperimentRunPlanFoldProjection {
    return new ExperimentRunPlanFoldProjection(deps);
  }

  private constructor(deps: { store: FoldProjectionStore<ExperimentRunPlanFoldState> }) {
    super();
    this.store = deps.store;
  }

  protected initState(): Omit<ExperimentRunPlanFoldState, TimestampKeys> {
    return { projectId: "", runId: "", experimentId: "", plan: null };
  }

  handleExperimentRunStarted(
    event: ExperimentRunStartedEvent,
    state: ExperimentRunPlanFoldState,
  ): ExperimentRunPlanFoldState {
    return {
      ...state,
      projectId: String(event.tenantId),
      runId: event.data.runId,
      experimentId: event.data.experimentId,
      plan: event.data.plan ?? null,
    };
  }
}
