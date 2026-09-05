import type { FoldProjectionStore, ProjectionStoreContext } from "@langwatch/eventing";
import type { ExperimentRunStateRepository } from "../../repositories/experiment-run-state.repository";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../../rules/experiment-run-event-types.rules";
import { parseExperimentRunKey } from "../../processes/experiment-run-key.process";
import type {
  ExperimentRunState,
  ExperimentRunStateData,
} from "../../projections/experiment-run-state.projection";

/**
 * The FoldProjectionStore for experiment run state.
 * Dumb read/write — state IS the data.
 */
export class ExperimentRunStateStore implements FoldProjectionStore<ExperimentRunStateData> {
  private constructor(private readonly repository: ExperimentRunStateRepository) {}

  static create(options: { repository: ExperimentRunStateRepository }): ExperimentRunStateStore {
    return new ExperimentRunStateStore(options.repository);
  }

  async store(state: ExperimentRunStateData, context: ProjectionStoreContext): Promise<void> {
    // Extract raw experimentId and runId from the composite aggregate key
    // so that RunId and ExperimentId are always populated consistently,
    // even before the "started" event sets them via apply().
    // This prevents the split-row bug where ExperimentId mutates from ""
    // to the real value between writes.
    const { experimentId, runId } = parseExperimentRunKey(context.aggregateId);
    const stateWithKeys: ExperimentRunStateData = {
      ...state,
      RunId: runId,
      ExperimentId: experimentId,
    };

    const projection: ExperimentRunState = {
      id: context.aggregateId,
      aggregateId: context.aggregateId,
      tenantId: context.tenantId,
      version: EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,
      data: stateWithKeys,
    };

    await this.repository.storeProjection(projection, {
      tenantId: context.tenantId,
    });
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<ExperimentRunStateData | null> {
    const projection = await this.repository.tryGetProjection(aggregateId, {
      tenantId: context.tenantId,
    });

    return (projection?.data as ExperimentRunStateData) ?? null;
  }
}
