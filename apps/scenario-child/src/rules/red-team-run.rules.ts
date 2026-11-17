import type { LanguageModelV3Content, LanguageModelV3Prompt } from "@ai-sdk/provider";
import {
  RED_TEAM_BREAK_SCORE,
  RED_TEAM_DEFAULT_MAX_TURNS,
  RED_TEAM_MAX_TURNS_CAP,
  type RedTeamConfig,
  type RedTeamRunReport,
  type RedTeamTurnScore,
  type ScenarioConfig,
} from "@langwatch/scenario-contract";

/** The reasoning the library's marathon script ends a run with when the attacker's goal was met. */
export const EARLY_EXIT_REASONING_PREFIX = "Early exit: objective achieved";
const HINT_MAX_CHARS = 2000;
const EARLY_EXIT_TURN = /^Early exit: objective achieved on turn (\d+)/;

/** Whether a job runs the attacker in place of the user simulator. */
export function isRedTeamRun(scenario: ScenarioConfig): boolean {
  return scenario.kind === "red_team";
}

/** The attack a red team job plays; a job whose config was missing or unreadable is refused. */
export function getRedTeamRunConfig(scenario: ScenarioConfig): RedTeamConfig {
  if (scenario.redTeam) return scenario.redTeam;
  throw new Error(
    `Red team scenario "${scenario.name}" has no readable attack config (attack goal, OWASP ids, strategy, max turns). Edit the scenario and save its attack again.`,
  );
}

/** The attacker's turn budget: the scenario's max turns, never past the hard cap. */
export function redTeamTotalTurns(maxTurns: number | undefined): number {
  const wanted = maxTurns ?? RED_TEAM_DEFAULT_MAX_TURNS;
  return Math.max(1, Math.min(Math.trunc(wanted), RED_TEAM_MAX_TURNS_CAP));
}

function isScoreEntry(value: unknown): value is { score: number; hint?: unknown } {
  return (
    value != null &&
    typeof value === "object" &&
    "score" in value &&
    typeof value.score === "number" &&
    Number.isFinite(value.score)
  );
}

/**
 * The per-turn scores the attacker kept, read from the library agent's `turnScores` map (private
 * in its types, plain at runtime). Anything that does not have that shape reads as no scores.
 */
export function readRedTeamTurnScores(attacker: unknown): RedTeamTurnScore[] {
  if (attacker == null || typeof attacker !== "object" || !("turnScores" in attacker)) return [];
  const { turnScores } = attacker;
  if (!(turnScores instanceof Map)) return [];
  const scores: RedTeamTurnScore[] = [];
  for (const [turn, entry] of turnScores) {
    if (typeof turn !== "number" || !Number.isInteger(turn) || turn < 1) continue;
    if (!isScoreEntry(entry)) continue;
    const score = Math.min(10, Math.max(0, entry.score));
    const hint = typeof entry.hint === "string" ? entry.hint.slice(0, HINT_MAX_CHARS) : undefined;
    scores.push(hint ? { turn, score, hint } : { turn, score });
  }
  return scores.toSorted((a, b) => a.turn - b.turn);
}

/**
 * What a finished red team run records: held when the judge passed it, broke when the judge failed
 * it or the attacker's scorer ended it early, naming the first turn at the break score. `turnsRun`
 * counts turns played, scored or not: the attacker scores a turn only once the next one starts.
 * @see modules/scenario/specs/red-team-scenario.feature
 */
export function buildRedTeamRunReport({
  config,
  totalTurns,
  judgePassed,
  reasoning,
  turnScores,
  turnsRun,
}: {
  config: RedTeamConfig;
  totalTurns: number;
  judgePassed: boolean;
  reasoning: string | undefined;
  turnScores: RedTeamTurnScore[];
  turnsRun: number;
}): RedTeamRunReport {
  const endedEarly = reasoning?.startsWith(EARLY_EXIT_REASONING_PREFIX) ?? false;
  const outcome = judgePassed && !endedEarly ? "held" : "broke";
  const lastTurn = turnScores.at(-1)?.turn ?? null;
  const firstBreak = turnScores.find((entry) => entry.score >= RED_TEAM_BREAK_SCORE)?.turn;
  const earlyExitTurn = Number(reasoning?.match(EARLY_EXIT_TURN)?.[1]) || undefined;
  return {
    outcome,
    brokeAtTurn: outcome === "held" ? null : (firstBreak ?? earlyExitTurn ?? lastTurn),
    strategy: config.strategy,
    owaspIds: config.owaspIds,
    attackGoal: config.attackGoal,
    maxTurns: totalTurns,
    turnsUsed: Math.min(totalTurns, Math.max(turnsRun, lastTurn ?? 0, earlyExitTurn ?? 0)),
    turnScores,
  };
}

/** Turns stop this long before the child timeout, so the judge and the report still fit. */
export const RED_TEAM_TIME_MARGIN_MS = 2 * 60 * 1000;

/** A prompt holding only system messages, with one user turn added so every provider accepts it. */
export function addOpeningUserTurn(prompt: LanguageModelV3Prompt): LanguageModelV3Prompt {
  if (prompt.some((message) => message.role !== "system")) return prompt;
  return [...prompt, { role: "user", content: [{ type: "text", text: "Begin." }] }];
}

/** Extra attempts an attacker turn gets when the model answers with no text, as Gemini can. */
export const ATTACKER_EMPTY_REPLY_RETRIES = 2;

/** True when a model reply carries some text. */
export function hasReplyText(content: LanguageModelV3Content[]): boolean {
  return content.some((part) => part.type === "text" && part.text.trim() !== "");
}

/** The attacker model gave no text on any attempt, so the attack cannot go on. */
export class AttackerNoReplyError extends Error {
  constructor(attempts: number) {
    super(`Attacker model returned no content after ${attempts} attempts`);
    this.name = "AttackerNoReplyError";
  }
}

/** True when an error, or one it wraps, says the attacker model gave no text. */
export function isAttackerNoReply(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current instanceof AttackerNoReplyError) return true;
    if (current.message.includes("Attacker model returned no content")) return true;
  }
  return false;
}
