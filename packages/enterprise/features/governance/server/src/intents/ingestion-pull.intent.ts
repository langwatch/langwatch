import { z } from "zod";
import { IngestionPullService } from "../services/ingestion-pull.service";

export const ingestionPullRunIntentSchema = z.object({
  sourceId: z.string(),
  runId: z.string(),
  scheduledFor: z.number(),
  cursor: z.string().nullable(),
});

export type IngestionPullRunIntent = z.infer<typeof ingestionPullRunIntentSchema>;

export class IngestionPullIntent {
  private constructor(private readonly execution: IngestionPullService) {}

  static create(execution: IngestionPullService): IngestionPullIntent {
    return new IngestionPullIntent(execution);
  }

  async execute(
    payload: IngestionPullRunIntent,
    context: { projectId: string; attempt: number },
  ): Promise<void> {
    await this.execution.execute({
      tenantId: context.projectId,
      attempt: context.attempt,
      pull: payload,
    });
  }
}
