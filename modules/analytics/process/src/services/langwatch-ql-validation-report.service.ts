import {
  LangWatchQLNotPermittedError,
  LangWatchQLUnparseableError,
  lwqlValidationResultSchema,
  type LangWatchQLService,
  type LangWatchQLTimeWindow,
  type LangWatchQLValidationResult,
} from "@langwatch/analytics-contract";

import type { WorkbenchProtectionsService } from "./workbench-protections.service.ts";

type LangWatchQLValidationReportDependencies = Readonly<{
  langWatchQL: Pick<LangWatchQLService, "validate">;
  protections: Pick<WorkbenchProtectionsService, "resolveMemberProtections">;
}>;

/** A member's statement judged by the one validator the run path uses, and never executed. */
export class LangWatchQLValidationReportService {
  static create(
    dependencies: LangWatchQLValidationReportDependencies,
  ): LangWatchQLValidationReportService {
    return new LangWatchQLValidationReportService(dependencies);
  }

  private constructor(private readonly dependencies: LangWatchQLValidationReportDependencies) {}

  /** The refusals with their positions; none when the statement would be admitted. */
  async report({
    projectId,
    userId,
    sql,
    parameters,
    timeWindow,
  }: {
    projectId: string;
    userId: string;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    timeWindow?: LangWatchQLTimeWindow;
  }): Promise<LangWatchQLValidationResult> {
    const protections = await this.dependencies.protections.resolveMemberProtections({
      projectId,
      userId,
    });

    try {
      this.dependencies.langWatchQL.validate({
        projectId,
        protections,
        sql,
        ...(parameters ? { parameters } : {}),
        ...(timeWindow ? { timeWindow } : {}),
      });
    } catch (error) {
      if (
        error instanceof LangWatchQLUnparseableError ||
        error instanceof LangWatchQLNotPermittedError
      ) {
        return lwqlValidationResultSchema.parse({ violations: error.meta.violations });
      }

      throw error;
    }

    return { violations: [] };
  }
}
