// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { IngestionPullRunStatusData } from "../../eventing/ingestion-pull-run-status-eventing.projection.ts";
import type { AgentsListingSummary } from "../../rules/agents-listing-outcome.rules.ts";
import { IngestionPullRunRepository } from "../ingestion-pull-run.repository.ts";

/** The run-status twin: one map standing in for the `IngestionPullRunProjection` table. */
export class MemoryIngestionPullRunRepository extends IngestionPullRunRepository {
  private readonly rows = new Map<string, StoredProjection<IngestionPullRunStatusData>>();

  static create(): MemoryIngestionPullRunRepository {
    return new MemoryIngestionPullRunRepository();
  }

  async get(
    projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<IngestionPullRunStatusData>> {
    const projection = this.rows.get(this.keyOf(String(context.tenantId), projectionKey));
    return projection ? { kind: "folded", projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<IngestionPullRunStatusData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.rows.set(this.keyOf(String(context.tenantId), projection.state.SourceId), projection);
  }

  async findAgentsListings({
    sourceIds,
    projectId,
  }: {
    sourceIds: readonly string[];
    projectId: string;
  }): Promise<Map<string, AgentsListingSummary>> {
    return new Map(
      sourceIds.flatMap((sourceId): [string, AgentsListingSummary][] =>
        this.rows.has(this.keyOf(projectId, sourceId))
          ? [[sourceId, { LastAgentsListingOutcome: null, LastAgentsListingReason: null }]]
          : [],
      ),
    );
  }

  private keyOf(projectId: string, sourceId: string): string {
    return `${projectId}:${sourceId}`;
  }
}
