import pino, { type Logger as PinoLogger } from "pino";

/** One captured log record: pino's own fields plus whatever was passed. */
export interface TestLogLine {
  level: number;
  msg?: string;
  [field: string]: unknown;
}

export interface TestLogLines extends Array<TestLogLine> {
  /**
   * The first line at `levelName` whose `msg` contains `msgIncludes`.
   *
   * Named `first` rather than `find` because this is an `Array` subtype: a
   * two-argument `find` does not satisfy `Array.prototype.find`, so declaring
   * one made the whole interface unassignable (TS2430) and took the package's
   * declaration build down with it.
   */
  first(levelName: string, msgIncludes: string): TestLogLine | undefined;
}

const LEVEL_NUMBERS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * A real pino logger that writes synchronously into an in-memory array
 * instead of stdout, for the tests that assert on logging rather than
 * silencing it. `lines.first` reads back one record by level name and a
 * substring of its message.
 */
export function createTestLogger(): { logger: PinoLogger; lines: TestLogLines } {
  const backing: TestLogLine[] = [];
  const findByLevelAndMessage = (levelName: string, msgIncludes: string): TestLogLine | undefined => {
    const wanted = LEVEL_NUMBERS[levelName];
    return Array.prototype.find.call(backing, (line: TestLogLine) => {
      if (wanted !== undefined && line.level !== wanted) return false;
      return typeof line.msg === "string" && line.msg.includes(msgIncludes);
    }) as TestLogLine | undefined;
  };
  const lines = Object.assign(backing, {
    first: findByLevelAndMessage,
  }) as unknown as TestLogLines;

  const destination = {
    write(chunk: string) {
      lines.push(JSON.parse(chunk) as TestLogLine);
    },
  };

  const logger = pino({ level: "trace" }, destination);
  return { logger, lines };
}
