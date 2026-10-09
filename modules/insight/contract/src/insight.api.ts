import { moduleApi } from "@langwatch/module";

import type { FileInsightInput, InsightEntry } from "./insight.ts";

/** Who is asking. An insight is read and acted on by its owner alone. */
type Reader = { userId: string };

/**
 * Each person's own insights in a project. Every operation refuses with
 * `insights_not_enabled` while `release_insights` is off for the project, and an insight
 * another person owns answers `insight_not_found`, exactly as an id no insight has.
 */
export interface InsightApi {
  /** The reader's own insights in the project, newest first, each with their own state. */
  findInsights(input: { projectId: string } & Reader): Promise<InsightEntry[]>;
  /** Files an insight the reader owns; the answer is the entry as their inbox will show it. */
  fileInsight(input: FileInsightInput & Reader): Promise<InsightEntry>;
  /** Ids the reader does not own are skipped, like ids no insight has. */
  markInsightsSeen(
    input: { projectId: string; insightIds: readonly string[] } & Reader,
  ): Promise<void>;
  /** "Mark done": moves the insight to the reader's Archived folder. */
  archiveInsight(input: { projectId: string; insightId: string } & Reader): Promise<void>;
  /** "Still relevant": back in the reader's inbox, whatever its validity says. */
  keepInsight(input: { projectId: string; insightId: string } & Reader): Promise<void>;
}

export const InsightApi = moduleApi<InsightApi>()("insight");
