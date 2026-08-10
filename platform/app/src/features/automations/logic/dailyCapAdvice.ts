import { TriggerAction } from "@langwatch/automations/enums";

/**
 * Actions that write one record per confirmed match, the only ones the plan's
 * daily automation ceiling governs. Notify actions are bounded by their digest
 * cadence and the email caps instead, so a busy notify automation is not over
 * this ceiling no matter how many traces it matches.
 *
 * Mirrors `PERSIST_TRIGGER_ACTIONS` on the dispatch side.
 */
const PERSIST_ACTIONS: readonly string[] = [
  TriggerAction.ADD_TO_DATASET,
  TriggerAction.ADD_TO_ANNOTATION_QUEUE,
];

/** The draft carries the action as a plain string once it round-trips through
 *  the URL or a saved row, so this compares values rather than enum identity. */
export function isPersistAction(action: string | null | undefined): boolean {
  return action != null && PERSIST_ACTIONS.includes(action);
}

export interface DailyCapAdvice {
  /** Estimated matches a day, rounded for display. */
  perDay: number;
  /** The plan's daily action ceiling. */
  cap: number;
}

/**
 * Whether the drafted automation should be told it would outrun the plan's
 * daily action ceiling, and the two numbers the warning quotes.
 *
 * This is advice, never a gate: every missing or unusable input returns null,
 * so a failed preview, a failed cap read, or an action the ceiling does not
 * govern all mean the author sees nothing extra and saves exactly as before.
 * The comparison uses the rounded estimate so the warning never claims that
 * "about 100 a day" is over a limit of 100.
 */
export function dailyCapAdvice({
  action,
  matchesPerDay,
  cap,
}: {
  action: string | null | undefined;
  /** Estimated matches a day, or null when the preview produced no count. */
  matchesPerDay: number | null | undefined;
  /** The plan's daily ceiling, or null when the cap read failed. */
  cap: number | null | undefined;
}): DailyCapAdvice | null {
  if (!isPersistAction(action)) return null;
  if (matchesPerDay == null || !Number.isFinite(matchesPerDay)) return null;
  if (cap == null || !Number.isFinite(cap) || cap <= 0) return null;

  const rounded = Math.round(matchesPerDay);
  if (rounded <= cap) return null;
  return { perDay: rounded, cap };
}
