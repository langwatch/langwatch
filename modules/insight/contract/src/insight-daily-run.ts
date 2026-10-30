/**
 * The daily insights run: Langy reads one board for one person and hands back findings, which
 * the insight module checks and files. Langy only reads; filing is the module's own write.
 * @see modules/insight/specs/insight-daily-run.feature
 * @see modules/insight/adrs/004-daily-run.md
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  DEFAULT_INSIGHT_VALID_DAYS,
  insightBodySchema,
  insightProjectScopeSchema,
  insightTitleSchema,
  insightToneSchema,
  insightTopicSchema,
  insightValidDaysSchema,
} from "./insight.ts";

const boardPointerShape = {
  id: z.string().min(1).max(200),
  /** The name as it was when the pointer was written; a run reads the live name itself. */
  name: z.string().trim().min(1).max(200),
};

/**
 * The board a run reads. Only a pointer: a stored board by its dashboard id, or a From
 * LangWatch board by its template id. A run checks that it exists, and as whom, when it runs.
 */
const insightRunBoardSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dashboard"), ...boardPointerShape }).strict(),
  z.object({ kind: z.literal("template"), ...boardPointerShape }).strict(),
]);
export interface InsightRunBoardSchema extends Named<typeof insightRunBoardSchemaDefinition> {}
export const insightRunBoardSchema: InsightRunBoardSchema = insightRunBoardSchemaDefinition;
export type InsightRunBoard = z.infer<typeof insightRunBoardSchema>;

/** How many findings one run may file; whatever Langy returns is cut to it. */
export const INSIGHT_RUN_MAX_INSIGHTS_CHOICES = [1, 3, 5, 10] as const;
export const DEFAULT_INSIGHT_RUN_MAX_INSIGHTS = 3;
export const insightRunMaxInsightsSchema = z.literal(INSIGHT_RUN_MAX_INSIGHTS_CHOICES);
export type InsightRunMaxInsights = z.infer<typeof insightRunMaxInsightsSchema>;

/**
 * `skipped` is a run its person could not have; `nothing` is one that found no news: Langy
 * read the board and reported none, or the project took no trace and Langy was not asked.
 */
export const INSIGHT_RUN_OUTCOMES = ["filed", "nothing", "failed", "skipped"] as const;
export const insightRunOutcomeSchema = z.enum(INSIGHT_RUN_OUTCOMES);
export type InsightRunOutcome = z.infer<typeof insightRunOutcomeSchema>;

/**
 * Why a run never reached Langy. `board_unreadable`: dashboards or custom charts are off, or
 * the catalogue no longer offers the From LangWatch board.
 */
export const INSIGHT_RUN_SKIP_REASONS = [
  "flag_off",
  "project_unavailable",
  "user_missing",
  "no_access",
  "langy_off",
  "board_deleted",
  "board_unreadable",
  "board_empty",
] as const;
export type InsightRunSkipReason = (typeof INSIGHT_RUN_SKIP_REASONS)[number];

/**
 * Why a run that reached Langy filed nothing it could trust. `finding_has_url`: a finding
 * held a web address, which a run never files.
 */
export const INSIGHT_RUN_FAILURE_REASONS = [
  "turn_failed",
  "turn_stopped",
  "needs_input",
  "timeout",
  "bad_output",
  "finding_has_url",
  "brief_changed",
  "rate_limited",
  "error",
] as const;
export type InsightRunFailureReason = (typeof INSIGHT_RUN_FAILURE_REASONS)[number];

/**
 * Why a run that could start found nothing without asking Langy. `no_new_traces`: the project
 * took no trace since the run's window began, so no widget had anything new to show.
 */
export const INSIGHT_RUN_QUIET_REASONS = ["no_new_traces"] as const;
export type InsightRunQuietReason = (typeof INSIGHT_RUN_QUIET_REASONS)[number];

/** Reasons no run records any more, still read from runs recorded before they retired. */
export const INSIGHT_RUN_RETIRED_REASONS = ["template_board"] as const;

export const insightRunReasonSchema = z.enum([
  ...INSIGHT_RUN_SKIP_REASONS,
  ...INSIGHT_RUN_FAILURE_REASONS,
  ...INSIGHT_RUN_QUIET_REASONS,
  ...INSIGHT_RUN_RETIRED_REASONS,
]);
export type InsightRunReason = z.infer<typeof insightRunReasonSchema>;

/** A schedule whose runs ended `skipped` on this many scheduled days in a row turns itself off. */
export const INSIGHT_SCHEDULE_SKIPPED_DAYS_BEFORE_OFF = 7;

/**
 * Why the system turned a schedule off. `board_deleted`: a run found its board gone.
 * `skipped_days`: its runs were skipped too many days in a row. `member_removed` and
 * `project_archived`: the person left the organisation, or the project was archived.
 */
export const INSIGHT_SCHEDULE_OFF_REASONS = [
  "board_deleted",
  "skipped_days",
  "member_removed",
  "project_archived",
] as const;
export const insightScheduleOffReasonSchema = z.enum(INSIGHT_SCHEDULE_OFF_REASONS);
export type InsightScheduleOffReason = z.infer<typeof insightScheduleOffReasonSchema>;

/** How a run ended, as its person reads it. */
const insightLastRunSchema = z.object({
  /** Epoch milliseconds. */
  at: z.number(),
  outcome: insightRunOutcomeSchema,
  reason: insightRunReasonSchema.nullable(),
  filedCount: z.number().int().nonnegative(),
  /** How many insights the run found still true and renewed; they are not new. */
  renewedCount: z.number().int().nonnegative(),
  conversationId: z.string().nullable(),
});

/** One person's run on one board, as they read it: the board and how the last run ended. */
const insightDailyRunSchemaDefinition = z.object({
  id: z.string(),
  board: insightRunBoardSchema,
  /** Null until a run settled. */
  lastRun: insightLastRunSchema.nullable(),
});
export interface InsightDailyRunSchema extends Named<typeof insightDailyRunSchemaDefinition> {}
export const insightDailyRunSchema: InsightDailyRunSchema = insightDailyRunSchemaDefinition;
export type InsightDailyRun = z.infer<typeof insightDailyRunSchema>;

/** The hour of the day a schedule runs at, read in its own time zone. */
export const insightRunHourSchema = z.number().int().min(0).max(23);

/** Whether the runtime knows the zone by name. An offset such as `+02:00` is not a zone. */
function isKnownTimezone(timezone: string): boolean {
  if (!/^[A-Za-z]/.test(timezone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** An IANA zone name, such as `Europe/Amsterdam` or `UTC`. */
const insightRunTimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isKnownTimezone, { message: "The time zone must be an IANA zone name." });

/** What a person chose for a board's daily run: when it runs and how much it may file. */
const insightRunSettingsSchemaDefinition = z.object({
  hour: insightRunHourSchema,
  timezone: insightRunTimezoneSchema,
  maxInsights: insightRunMaxInsightsSchema,
});
export interface InsightRunSettingsSchema extends Named<
  typeof insightRunSettingsSchemaDefinition
> {}
export const insightRunSettingsSchema: InsightRunSettingsSchema =
  insightRunSettingsSchemaDefinition;
export type InsightRunSettings = z.infer<typeof insightRunSettingsSchema>;

/** `undecided`: the person was never asked, or closed the offer without an answer. */
export const INSIGHT_SCHEDULE_STATES = ["undecided", "off", "on"] as const;
export const insightScheduleStateSchema = z.enum(INSIGHT_SCHEDULE_STATES);
export type InsightScheduleState = z.infer<typeof insightScheduleStateSchema>;

/**
 * One person's daily run setting on one board, as they alone read it. `settings` is what they
 * last chose, kept while the run is off, and null until they turned it on once.
 */
const insightDailyRunSettingSchemaDefinition = z.object({
  state: insightScheduleStateSchema,
  settings: insightRunSettingsSchema.nullable(),
  /** Null until a run settled. */
  lastRun: insightLastRunSchema.nullable(),
  /** Why the system turned it off; null while it is on, and when the person turned it off. */
  offReason: insightScheduleOffReasonSchema.nullable(),
});
export interface InsightDailyRunSettingSchema extends Named<
  typeof insightDailyRunSettingSchemaDefinition
> {}
export const insightDailyRunSettingSchema: InsightDailyRunSettingSchema =
  insightDailyRunSettingSchemaDefinition;
export type InsightDailyRunSetting = z.infer<typeof insightDailyRunSettingSchema>;

/**
 * One schedule as an operator lists it, across projects: whose it is, which board, whether it
 * is on and why not, when it next runs and how its last run ended. Instants are epoch
 * milliseconds.
 */
const insightOperatorDailyScheduleSchemaDefinition = z.object({
  scheduleId: z.string(),
  projectId: z.string(),
  userId: z.string(),
  board: insightRunBoardSchema,
  state: z.enum(["on", "off"]),
  offReason: insightScheduleOffReasonSchema.nullable(),
  settings: insightRunSettingsSchema.nullable(),
  /** The wake the schedule's process has armed; null when it is off or lost its wake. */
  nextRunAt: z.number().nullable(),
  lastRun: insightLastRunSchema.nullable(),
  /** The scheduled days in a row whose run ended `skipped`. */
  consecutiveSkips: z.number().int().nonnegative(),
});
export interface InsightOperatorDailyScheduleSchema extends Named<
  typeof insightOperatorDailyScheduleSchemaDefinition
> {}
export const insightOperatorDailyScheduleSchema: InsightOperatorDailyScheduleSchema =
  insightOperatorDailyScheduleSchemaDefinition;
export type InsightOperatorDailySchedule = z.infer<typeof insightOperatorDailyScheduleSchema>;

/** Which board's daily run a person reads: the pointer's kind and id, no name. */
const insightBoardDailyRunScopeSchemaDefinition = z.object({
  ...insightProjectScopeSchema.shape,
  board: z.object({ kind: z.enum(["dashboard", "template"]), id: boardPointerShape.id }).strict(),
});
export interface InsightBoardDailyRunScopeSchema extends Named<
  typeof insightBoardDailyRunScopeSchemaDefinition
> {}
export const insightBoardDailyRunScopeSchema: InsightBoardDailyRunScopeSchema =
  insightBoardDailyRunScopeSchemaDefinition;
export type InsightBoardDailyRunScope = z.infer<typeof insightBoardDailyRunScopeSchema>;

/** Turns a board's daily run on, or changes when it runs and how much it may file. */
const configureInsightDailyRunInputSchemaDefinition = z.object({
  ...insightProjectScopeSchema.shape,
  board: insightRunBoardSchema,
  ...insightRunSettingsSchema.shape,
});
export interface ConfigureInsightDailyRunInputSchema extends Named<
  typeof configureInsightDailyRunInputSchemaDefinition
> {}
export const configureInsightDailyRunInputSchema: ConfigureInsightDailyRunInputSchema =
  configureInsightDailyRunInputSchemaDefinition;
export type ConfigureInsightDailyRunInput = z.infer<typeof configureInsightDailyRunInputSchema>;

/** Turns a board's daily run off; also what "No thanks" on the offer stores. */
const turnOffInsightDailyRunInputSchemaDefinition = z.object({
  ...insightProjectScopeSchema.shape,
  board: insightRunBoardSchema,
});
export interface TurnOffInsightDailyRunInputSchema extends Named<
  typeof turnOffInsightDailyRunInputSchemaDefinition
> {}
export const turnOffInsightDailyRunInputSchema: TurnOffInsightDailyRunInputSchema =
  turnOffInsightDailyRunInputSchemaDefinition;
export type TurnOffInsightDailyRunInput = z.infer<typeof turnOffInsightDailyRunInputSchema>;

const requestInsightDailyRunInputSchemaDefinition = z.object({
  ...insightProjectScopeSchema.shape,
  userId: z.string().min(1),
  board: insightRunBoardSchema,
  maxInsights: insightRunMaxInsightsSchema.default(DEFAULT_INSIGHT_RUN_MAX_INSIGHTS),
});
export interface RequestInsightDailyRunInputSchema extends Named<
  typeof requestInsightDailyRunInputSchemaDefinition
> {}
export const requestInsightDailyRunInputSchema: RequestInsightDailyRunInputSchema =
  requestInsightDailyRunInputSchemaDefinition;
export type RequestInsightDailyRunInput = z.input<typeof requestInsightDailyRunInputSchema>;

/** The fence tag of the block an answer ended with before the card; read for one release. */
export const INSIGHT_RUN_FINDINGS_FENCE_TAG = "langwatch-insights";

/** A run's answer may name more than it may file, never an unbounded list. */
export const INSIGHT_RUN_MAX_FINDINGS_IN_ANSWER = 50;

/** A run's finding is a headline and a few paragraphs; shorter than what a person may save. */
export const INSIGHT_RUN_FINDING_TITLE_MAX = 120;
export const INSIGHT_RUN_FINDING_BODY_MAX = 4_000;
/** A finding's key is a few words joined by hyphens, never a sentence. */
export const INSIGHT_RUN_FINDING_KEY_MAX = 80;

/**
 * One finding as a run takes it from Langy's insights card. Strict: a key that is not listed
 * here refuses the whole answer, so an answer cannot name an owner, a project or a board.
 */
const insightRunFindingSchemaDefinition = z
  .object({
    title: insightTitleSchema.max(INSIGHT_RUN_FINDING_TITLE_MAX),
    body: insightBodySchema.max(INSIGHT_RUN_FINDING_BODY_MAX),
    tone: insightToneSchema,
    topic: insightTopicSchema.optional(),
    validDays: insightValidDaysSchema.default(DEFAULT_INSIGHT_VALID_DAYS),
    /** A widget of the board; one that is not on it is dropped, never trusted. */
    widgetId: z.string().min(1).max(200).optional(),
    lwql: z.string().trim().min(1).max(20_000).optional(),
    /** A name for what was found that stays the same when a later run finds it again. */
    key: z.string().trim().min(1).max(INSIGHT_RUN_FINDING_KEY_MAX).optional(),
    /** The open insight this finding repeats; one that is not the person's is ignored. */
    renews: z.string().min(1).max(200).optional(),
  })
  .strict();
export interface InsightRunFindingSchema extends Named<typeof insightRunFindingSchemaDefinition> {}
export const insightRunFindingSchema: InsightRunFindingSchema = insightRunFindingSchemaDefinition;
export type InsightRunFinding = z.infer<typeof insightRunFindingSchema>;

const insightRunFindingsSchemaDefinition = z
  .object({
    findings: z.array(insightRunFindingSchema).max(INSIGHT_RUN_MAX_FINDINGS_IN_ANSWER),
  })
  .strict();
export interface InsightRunFindingsSchema extends Named<
  typeof insightRunFindingsSchemaDefinition
> {}
export const insightRunFindingsSchema: InsightRunFindingsSchema =
  insightRunFindingsSchemaDefinition;
