import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import type { LegacyEvaluationInputsPurgeService } from "../services/legacy-evaluation-inputs-purge.service.ts";

const logger = createLogger("langwatch:tasks:purge-legacy-evaluation-inputs");

/** Removes main-era evaluation-input rows and bytes; `--apply` deletes, the default only counts. */
export class LegacyEvaluationInputsPurgeTask extends Task {
  readonly name = "purge-legacy-evaluation-inputs";
  readonly description =
    "Deletes main-era evaluation_inputs stored objects (ADR-172). Run after evaluation's copy step; --apply to delete.";

  private constructor(private readonly purge: LegacyEvaluationInputsPurgeService) {
    super();
  }

  static create({
    purge,
  }: {
    purge: LegacyEvaluationInputsPurgeService;
  }): LegacyEvaluationInputsPurgeTask {
    return new LegacyEvaluationInputsPurgeTask(purge);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const apply = args.includes("--apply");
    const report = await this.purge.purge({ apply, signal });
    logger.info({ apply, ...report }, "Legacy evaluation inputs purge finished");
  }
}
