import type { EmittedEvent } from "@langwatch/event-sourcing";

import type {
  IngestionPullConfiguredData,
  IngestionPullDisabledData,
  IngestionPullRunCompletedData,
  IngestionPullRunFailedData,
  ingestionPullEvents,
} from "./schemas/events";

type Emitted = readonly EmittedEvent<typeof ingestionPullEvents>[];

/** All four are pure: the config version, the cursor and the run outcome all
 * arrive already decided on the input (ADR-105 decision 7). */

export async function configureIngestionPull(
  input: IngestionPullConfiguredData,
): Promise<Emitted> {
  return [{ type: "configured", data: input }];
}

export async function disableIngestionPull(
  input: IngestionPullDisabledData,
): Promise<Emitted> {
  return [{ type: "disabled", data: input }];
}

export async function recordIngestionPullRunCompleted(
  input: IngestionPullRunCompletedData,
): Promise<Emitted> {
  return [{ type: "runCompleted", data: input }];
}

export async function recordIngestionPullRunFailed(
  input: IngestionPullRunFailedData,
): Promise<Emitted> {
  return [{ type: "runFailed", data: input }];
}
