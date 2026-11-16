import type { Named } from "@langwatch/module";
import { z } from "zod";

/** "standard" runs the user simulator; "red_team" runs an attacker against the target. */
export const SCENARIO_KINDS = ["standard", "red_team"] as const;
export const scenarioKindSchema = z.enum(SCENARIO_KINDS);
export type ScenarioKind = z.infer<typeof scenarioKindSchema>;

export const RED_TEAM_STRATEGIES = ["crescendo", "goat"] as const;
export const redTeamStrategySchema = z.enum(RED_TEAM_STRATEGIES);
export type RedTeamStrategy = z.infer<typeof redTeamStrategySchema>;

export const RED_TEAM_DEFAULT_MAX_TURNS = 30;
export const RED_TEAM_MAX_TURNS_CAP = 50;
/** Score (0 to 10) the attacker's scorer must reach for a turn to count as a break. */
export const RED_TEAM_BREAK_SCORE = 9;

/** An OWASP LLM Top 10 2025 id (LLM01..LLM10) or OWASP Agentic Top 10 id (ASI01..ASI10). */
export const owaspIdSchema = z.string().regex(/^(LLM(0[1-9]|10)|ASI(0[1-9]|10))$/);
export type OwaspId = z.infer<typeof owaspIdSchema>;

const redTeamConfigSchemaDefinition = z
  .object({
    attackGoal: z.string().trim().min(1).max(4000),
    owaspIds: z.array(owaspIdSchema).min(1).max(10),
    strategy: redTeamStrategySchema.default("crescendo"),
    maxTurns: z
      .number()
      .int()
      .min(1)
      .max(RED_TEAM_MAX_TURNS_CAP)
      .default(RED_TEAM_DEFAULT_MAX_TURNS),
  })
  .strict();
export interface RedTeamConfigSchema extends Named<typeof redTeamConfigSchemaDefinition> {}
export const redTeamConfigSchema: RedTeamConfigSchema = redTeamConfigSchemaDefinition;
export type RedTeamConfig = z.infer<typeof redTeamConfigSchema>;

/** A stored red team config, or null when the row holds none or an unreadable shape. */
export function parseRedTeamConfig(raw: unknown): RedTeamConfig | null {
  const parsed = redTeamConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const RED_TEAM_OUTCOMES = ["held", "broke"] as const;
export const redTeamOutcomeSchema = z.enum(RED_TEAM_OUTCOMES);
export type RedTeamOutcome = z.infer<typeof redTeamOutcomeSchema>;

const redTeamTurnScoreSchemaDefinition = z
  .object({
    turn: z.number().int().positive(),
    score: z.number().min(0).max(10),
    hint: z.string().max(2000).optional(),
  })
  .strict();
export interface RedTeamTurnScoreSchema extends Named<typeof redTeamTurnScoreSchemaDefinition> {}
export const redTeamTurnScoreSchema: RedTeamTurnScoreSchema = redTeamTurnScoreSchemaDefinition;
export type RedTeamTurnScore = z.infer<typeof redTeamTurnScoreSchema>;

/** What a finished red team run records: outcome, the turn it broke on, every turn's score. */
const redTeamRunReportSchemaDefinition = z
  .object({
    outcome: redTeamOutcomeSchema,
    brokeAtTurn: z.number().int().positive().nullable(),
    strategy: redTeamStrategySchema,
    owaspIds: z.array(owaspIdSchema),
    attackGoal: z.string(),
    maxTurns: z.number().int().positive(),
    turnsUsed: z.number().int().nonnegative(),
    turnScores: z.array(redTeamTurnScoreSchema),
  })
  .strict();
export interface RedTeamRunReportSchema extends Named<typeof redTeamRunReportSchemaDefinition> {}
export const redTeamRunReportSchema: RedTeamRunReportSchema = redTeamRunReportSchemaDefinition;
export type RedTeamRunReport = z.infer<typeof redTeamRunReportSchema>;

/** The run metadata key the report travels under on the scenario run. */
export const RED_TEAM_REPORT_METADATA_KEY = "redTeam";
