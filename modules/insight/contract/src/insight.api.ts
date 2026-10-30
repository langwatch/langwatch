import { moduleApi } from "@langwatch/module";

import type {
  ConfigureInsightDailyRunInput,
  InsightBoardDailyRunScope,
  InsightDailyRun,
  InsightDailyRunSetting,
  InsightOperatorDailySchedule,
  RequestInsightDailyRunInput,
  TurnOffInsightDailyRunInput,
} from "./insight-daily-run.ts";
import type {
  FileInsightInput,
  InsightActionRun,
  InsightEntry,
  RunInsightActionInput,
} from "./insight.ts";

/** Who is asking. An insight is read and acted on by its owner alone. */
type Reader = { userId: string };

/** The person behind a click as their session proved them; Langy's turn runs as them. */
type Clicker = Reader & { name: string | null; email: string | null };

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
   * Sends one stored action to Langy as the clicker, in their own conversation: the source, a
   * fork of it, or a new one when it is gone. `insight_actions_not_enabled` while the flag is
   * off; `insight_action_from_run` for an insight a run filed or saved from a run's conversation.
   */
  runInsightAction(input: RunInsightActionInput & Clicker): Promise<InsightActionRun>;
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
  /**
   * Every person's daily run that is on or off, in every project, for the operator's list: the
   * ones that are on first. It names no reader and asks no flag; its door asks the operator.
   */
  findOperatorDailySchedules(input: { limit: number }): Promise<InsightOperatorDailySchedule[]>;
}

export const InsightApi = moduleApi<InsightApi>()("insight");
