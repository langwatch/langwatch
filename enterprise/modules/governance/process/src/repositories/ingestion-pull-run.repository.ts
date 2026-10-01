// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { IngestionPullRunStatusData } from "../eventing/ingestion-pull-run-status-eventing.projection.ts";
import type { AgentsListingSummary } from "../rules/agents-listing-outcome.rules.ts";

/** Each source's folded run status, and the agents-listing columns the agents screen reads. */
export abstract class IngestionPullRunRepository {
  abstract get(
    projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<IngestionPullRunStatusData>>;
  abstract store(
    projection: StoredProjection<IngestionPullRunStatusData>,
    context: ProjectionStoreContext,
  ): Promise<void>;
  abstract findAgentsListings(input: {
    sourceIds: readonly string[];
    projectId: string;
  }): Promise<Map<string, AgentsListingSummary>>;
}
