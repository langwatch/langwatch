import { TriggerFilterQueryInvalidError } from "@langwatch/automation-contract";
import { FilterParseError, type TraceApi } from "@langwatch/trace-contract";

import type { AutomationTraceFilterCompiler } from "../app/automation.app.ts";
import type { AutomationLogger } from "./automation.service.ts";

/**
 * ADR-043's filter-query dry run, over trace's own translator as main's
 * readFilterQuery used it. The translator's account can name internal
 * columns, so it goes to the log and the author gets the handled error.
 */
export class AutomationTraceFilterCompilerService implements AutomationTraceFilterCompiler {
  static create(input: {
    traces: Pick<TraceApi, "translateTraceFilter">;
    logger: AutomationLogger;
  }): AutomationTraceFilterCompilerService {
    return new AutomationTraceFilterCompilerService(input.traces, input.logger);
  }

  private constructor(
    private readonly traces: Pick<TraceApi, "translateTraceFilter">,
    private readonly logger: AutomationLogger,
  ) {}

  assertCompiles({ query, projectId }: Readonly<{ query: string; projectId: string }>): void {
    try {
      this.traces.translateTraceFilter({
        query,
        tenantId: projectId,
        timeRange: { from: 0, to: 0 },
      });
    } catch (error) {
      if (!(error instanceof FilterParseError)) throw error;
      this.logger.warn(
        { projectId, error: error.message },
        "trace query refused by the translator",
      );
      throw new TriggerFilterQueryInvalidError();
    }
  }
}
