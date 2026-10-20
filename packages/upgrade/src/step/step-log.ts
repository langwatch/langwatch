/**
 * What one attempt of a step said, redacted and bounded, for the ledger row and its diagnostics.
 * Spec: specs/upgrade/step-diagnostics.feature
 */
import { nowInstant } from "@langwatch/time";

import { redactSecrets } from "../runner/run-log.ts";

/** How many of an attempt's last lines the step row keeps (plan decision 3). */
export const STEP_LOG_TAIL_LINES = 200;

/** The longest error or log line the ledger stores; diagnostics cap strings the same way. */
export const LEDGER_TEXT_MAX_CHARS = 4096;

const CUT_MARK = " [cut]";

/** How a step's run reports progress; each line also reaches the worker's own log. */
export interface MigrationStepLog {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

export type LedgerTextRedactor = (text: string) => string;

/** Masks each secret value the process holds, then the URL passwords and `key=value` secrets. */
export function ledgerRedactor({
  secretValues,
}: {
  secretValues: readonly (string | undefined)[];
}): LedgerTextRedactor {
  const values = secretValues
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length >= 8)
    .toSorted((left, right) => right.length - left.length);
  return (text) =>
    redactSecrets(values.reduce((each, value) => each.split(value).join("***"), text));
}

/** Redacted, then cut to {@link LEDGER_TEXT_MAX_CHARS} with a mark saying so. */
export function ledgerText({ text, redact }: { text: string; redact: LedgerTextRedactor }): string {
  const redacted = redact(text);
  if (redacted.length <= LEDGER_TEXT_MAX_CHARS) return redacted;
  return `${redacted.slice(0, LEDGER_TEXT_MAX_CHARS - CUT_MARK.length)}${CUT_MARK}`;
}

type Forward = (level: "info" | "warn", message: string, fields: Record<string, unknown>) => void;

/** One attempt's log: forwards each line and keeps the last {@link STEP_LOG_TAIL_LINES}. */
export class StepLogTail implements MigrationStepLog {
  private readonly lines: string[] = [];

  private constructor(
    private readonly options: { redact: LedgerTextRedactor; forward: Forward; now: () => string },
  ) {}

  static create({
    redact,
    forward,
    now = () => nowInstant().toString(),
  }: {
    redact: LedgerTextRedactor;
    forward: Forward;
    /** The moment each line is stamped with, as an ISO instant. */
    now?: () => string;
  }): StepLogTail {
    return new StepLogTail({ redact, forward, now });
  }

  info(message: string, fields: Record<string, unknown> = {}): void {
    this.keep({ level: "info", message, fields, shouldForward: true });
  }

  warn(message: string, fields: Record<string, unknown> = {}): void {
    this.keep({ level: "warn", message, fields, shouldForward: true });
  }

  /** Keeps a line the caller already logged its own way, without forwarding it again. */
  keepOnly(line: {
    level: "info" | "warn";
    message: string;
    fields?: Record<string, unknown>;
  }): void {
    this.keep({ ...line, fields: line.fields ?? {}, shouldForward: false });
  }

  /** The attempt's last lines, oldest first. */
  tail(): string[] {
    return [...this.lines];
  }

  private keep({
    level,
    message,
    fields,
    shouldForward,
  }: {
    level: "info" | "warn";
    message: string;
    fields: Record<string, unknown>;
    shouldForward: boolean;
  }): void {
    if (shouldForward) {
      this.options.forward(
        level,
        this.options.redact(message),
        redactFields({ value: fields, redact: this.options.redact }) as Record<string, unknown>,
      );
    }
    const extra = Object.keys(fields).length > 0 ? ` ${safeJson(fields)}` : "";
    const line = `${this.options.now()} ${level} ${message}${extra}`;
    this.lines.push(ledgerText({ text: line, redact: this.options.redact }));
    this.lines.splice(0, Math.max(0, this.lines.length - STEP_LOG_TAIL_LINES));
  }
}

function redactFields({ value, redact }: { value: unknown; redact: LedgerTextRedactor }): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((each) => redactFields({ value: each, redact }));
  if (value instanceof Error) return redact(value.message);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, each]) => [key, redactFields({ value: each, redact })]),
    );
  }
  return value;
}

function safeJson(fields: Record<string, unknown>): string {
  try {
    return JSON.stringify(fields, (_key, value: unknown) =>
      value instanceof Error ? value.message : value,
    );
  } catch {
    return "{unserialisable fields}";
  }
}
