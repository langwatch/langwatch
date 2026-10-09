import type { StoredProjection } from "@langwatch/eventing";

import type { InsightReaderState } from "../../eventing/insight-reader.projection.ts";
import type { InsightState } from "../../eventing/insight.projection.ts";

/** The rows the memory tier's projection stores write and its read repository joins. */
export class InsightMemoryStore {
  /** Keyed `projectId:insightId`. */
  readonly insights = new Map<string, StoredProjection<InsightState>>();
  /** Keyed `projectId:insightId:userId`. */
  readonly readers = new Map<string, StoredProjection<InsightReaderState>>();

  private constructor() {}

  static create(): InsightMemoryStore {
    return new InsightMemoryStore();
  }

  static insightKey({ projectId, insightId }: { projectId: string; insightId: string }): string {
    return `${projectId}:${insightId}`;
  }

  static readerKey({
    projectId,
    insightId,
    userId,
  }: {
    projectId: string;
    insightId: string;
    userId: string;
  }): string {
    return `${projectId}:${insightId}:${userId}`;
  }
}
