import type { Logger } from "@langwatch/observability";
import type { CounterHandle } from "@langwatch/observability/metrics";

import {
  hashStatement,
  originOfStatement,
  type LangWatchQLOrigin,
} from "../rules/lwql-statement-origin.rules.ts";
import { langWatchQLAccessRefusals } from "./langwatch-ql-access-refusal.service.ts";

/** One message for every built-in failure, so the log pipeline keys them all to one signature. */
const BUILT_IN_FAILURE_MESSAGE = "built-in LangWatchQL statement failed";

/**
 * The code on the error as it reaches the door: a handled one such as `lwql_invalid_query`
 * (the engine's number rides in its `reasons`, which are never logged), or "unknown".
 */
function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : "unknown";
}

/**
 * Reports a failed LangWatchQL query by who wrote it: a built-in statement is one error line
 * (never the text or parameter values), a user-written one only a count; the code never decides
 * the origin. A caller's own access refusal is neither reported nor counted, on either path.
 * @see specs/lwql/query-origin.feature
 */
export class LangWatchQLFailureReportService {
  private constructor(
    private readonly logger: Pick<Logger, "error">,
    private readonly failures: CounterHandle,
    private readonly originOf: (input: { sql: string }) => LangWatchQLOrigin,
  ) {}

  static create(options: {
    logger: Pick<Logger, "error">;
    failures: CounterHandle;
    originOf?: (input: { sql: string }) => LangWatchQLOrigin;
  }): LangWatchQLFailureReportService {
    return new LangWatchQLFailureReportService(
      options.logger,
      options.failures,
      options.originOf ?? originOfStatement,
    );
  }

  /** Runs a workbench statement; a failure is reported by its text as sent, then rethrown as is. */
  async reportingFailures<Result>({
    projectId,
    sql,
    run,
  }: {
    projectId: string;
    sql: string;
    run: () => Promise<Result>;
  }): Promise<Result> {
    try {
      return await run();
    } catch (error) {
      this.reportFailure({ projectId, sql, error });
      throw error;
    }
  }

  /** A failed statement on the workbench door: its origin is read from `sql` as sent. */
  reportFailure({
    projectId,
    sql,
    error,
  }: {
    projectId: string;
    sql: string;
    error: unknown;
  }): void {
    if (langWatchQLAccessRefusals.isCallerAccessRefusal({ error })) return;
    const origin = this.originOf({ sql });
    this.failures.inc({ origin }, 1);
    if (origin === "user_written") return;

    this.logger.error(
      { origin, errorCode: errorCodeOf(error), projectId, statementHash: hashStatement({ sql }) },
      BUILT_IN_FAILURE_MESSAGE,
    );
  }

  /** A failed statement the server itself wrote: built in, named by its fixed `source`, no hash. */
  reportBuiltInFailure({
    projectId,
    source,
    error,
  }: {
    projectId: string;
    source: string;
    error: unknown;
  }): void {
    if (langWatchQLAccessRefusals.isCallerAccessRefusal({ error })) return;
    this.failures.inc({ origin: "built_in" }, 1);
    this.logger.error(
      { origin: "built_in", errorCode: errorCodeOf(error), projectId, source },
      BUILT_IN_FAILURE_MESSAGE,
    );
  }
}
