import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../";
import { BaseMemoryProjectionStore } from "../../../stores/baseMemoryProjectionStore";
import type { ExperimentRunStateRepository } from "./experimentRunState.repository";

export class ExperimentRunStateRepositoryMemory<
    ProjectionType extends Projection = Projection,
  >
  extends BaseMemoryProjectionStore<ProjectionType>
  implements ExperimentRunStateRepository<ProjectionType>
{
  /**
   * The durable dedup watermark, keyed exactly as the projections are.
   *
   * Held here rather than left unimplemented so tests exercise the same
   * redelivery semantics production gets from `experiment_runs.AppliedEventIds`
   * (migration 00064). A memory repository that silently answered "no
   * watermark" would make the executor's blind-re-apply path look like the
   * normal one, which is the failure this whole mechanism exists to catch.
   */
  private readonly appliedEventIdsByKey = new Map<string, string[]>();

  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }

  async getProjectionWithApplied(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<{ projection: ProjectionType | null; appliedEventIds: string[] }> {
    const projection = await this.getProjection(aggregateId, context);
    return {
      projection,
      appliedEventIds: [
        ...(this.appliedEventIdsByKey.get(
          this.getKey(String(context.tenantId), aggregateId),
        ) ?? []),
      ],
    };
  }

  override async storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
    appliedEventIds: readonly string[] = [],
  ): Promise<void> {
    await super.storeProjection(projection, context);
    this.appliedEventIdsByKey.set(
      this.getKey(String(context.tenantId), String(projection.aggregateId)),
      [...appliedEventIds],
    );
  }
}
