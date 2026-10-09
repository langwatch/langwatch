import { moduleApi } from "@langwatch/module";

import type { FileInsightInput, InsightEntry } from "./insight.ts";

/** Who is asking: per-reader state is always the caller's own. */
type Reader = { userId: string };

/**
 * The project's insights inbox. Every operation refuses with `insights_not_enabled` while
 * `release_insights` is off for the project.
 */
export interface InsightApi {
  /** The project's insights, newest first, each with the reader's own state. */
  findInsights(input: { projectId: string } & Reader): Promise<InsightEntry[]>;
  /** Files an insight; the answer is the entry as the inbox will show it. */
  fileInsight(input: FileInsightInput & Reader): Promise<InsightEntry>;
  markInsightsSeen(
    input: { projectId: string; insightIds: readonly string[] } & Reader,
  ): Promise<void>;
  /** "Mark done": moves the insight to the reader's Archived folder. */
  archiveInsight(input: { projectId: string; insightId: string } & Reader): Promise<void>;
  /** "Still relevant": back in the reader's inbox, whatever its validity says. */
  keepInsight(input: { projectId: string; insightId: string } & Reader): Promise<void>;
}

export const InsightApi = moduleApi<InsightApi>()("insight");
