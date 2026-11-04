import type { Logger } from "@langwatch/observability";
import type { CounterHandle } from "@langwatch/observability/metrics";

import type { LangWatchQLOrigin } from "../rules/lwql-statement-origin.rules.ts";

/**
 * Reports a failed LangWatchQL query by who wrote it: a built-in statement is one error line
 * (origin, error code, project id, statement hash; never the text or parameter values), a
 * user-written one is a count by origin.
 * @see specs/lwql/query-origin.feature
 */
export class LangWatchQLFailureReportService {
  private constructor() {}

  static create(_options: {
    logger: Pick<Logger, "error">;
    failures: CounterHandle;
    originOf?: (input: { sql: string }) => LangWatchQLOrigin;
  }): LangWatchQLFailureReportService {
    throw new Error("not implemented");
  }

  /** A failed statement on the workbench door: its origin is read from `sql` as sent. */
  reportFailure(_input: { projectId: string; sql: string; error: unknown }): void {
    throw new Error("not implemented");
  }

  /** A failed statement the server itself wrote: built in, with no hash. */
  reportBuiltInFailure(_input: { projectId: string; error: unknown }): void {
    throw new Error("not implemented");
  }
}
