import { moduleApi } from "@langwatch/module";

import type {
  ConfigureInsightDailyRunInput,
  InsightBoardDailyRunScope,
  InsightDailyRun,
  InsightDailyRunSetting,
  RequestInsightDailyRunInput,
  TurnOffInsightDailyRunInput,
} from "./insight-daily-run.ts";
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
  /**
   * Asks for one daily insights run now, for a person on a board. The answer names the request,
   * never a run: the worker starts none for it while a run is in flight for that board.
   */
  requestDailyRun(input: RequestInsightDailyRunInput): Promise<{ requestId: string }>;
  /** The reader's own runs in the project, one per board, each with how its last run ended. */
  findDailyRuns(input: { projectId: string } & Reader): Promise<InsightDailyRun[]>;
  /** The reader's own daily run on one board: `undecided` until they turned it on or off. */
  getDailyRunSetting(input: InsightBoardDailyRunScope & Reader): Promise<InsightDailyRunSetting>;
  /**
   * Turns the reader's daily run on for a board, or changes its hour, zone or maximum. A stored
   * board the reader cannot open answers `dashboard_not_found`, like one that does not exist.
   */
  configureDailyRun(input: ConfigureInsightDailyRunInput & Reader): Promise<void>;
  /** Turns the reader's daily run off for a board; "No thanks" on the offer stores the same. */
  turnOffDailyRun(input: TurnOffInsightDailyRunInput & Reader): Promise<void>;
}

export const InsightApi = moduleApi<InsightApi>()("insight");
