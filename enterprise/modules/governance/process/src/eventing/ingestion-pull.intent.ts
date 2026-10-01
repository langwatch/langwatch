import { z } from "zod";

import type { IngestionPullListingService } from "../services/ingestion-pull-listing.service.ts";
import type { IngestionPullService } from "../services/ingestion-pull.service.ts";

export const INGESTION_PULL_PROCESS_INTENT_TYPES = {
  RUN: "run",
  LIST_AGENTS: "listAgents",
  LIST_PEOPLE: "listPeople",
} as const;

export const ingestionPullRunIntentSchema = z.object({
  sourceId: z.string(),
  runId: z.string(),
  scheduledFor: z.number(),
  cursor: z.string().nullable(),
  abandonedRunId: z.string().optional(),
});

/** One schema for both listings: which list was asked is the intent's own type. */
export const ingestionPullListingIntentSchema = z.object({
  sourceId: z.string(),
  requestId: z.string(),
  requestedAt: z.number(),
});

export type IngestionPullRunIntent = z.infer<typeof ingestionPullRunIntentSchema>;
export type IngestionPullListingPayload = z.infer<typeof ingestionPullListingIntentSchema>;

type IntentContext = { projectId: string; attempt: number };

export class IngestionPullIntent {
  private constructor(private readonly execution: IngestionPullService) {}

  static create(execution: IngestionPullService): IngestionPullIntent {
    return new IngestionPullIntent(execution);
  }

  async execute(payload: IngestionPullRunIntent, context: IntentContext): Promise<void> {
    await this.execution.execute({
      tenantId: context.projectId,
      attempt: context.attempt,
      pull: payload,
    });
  }
}

export class IngestionPullListingIntent {
  private constructor(private readonly listing: IngestionPullListingService) {}

  static create(listing: IngestionPullListingService): IngestionPullListingIntent {
    return new IngestionPullListingIntent(listing);
  }

  listAgents(payload: IngestionPullListingPayload, context: IntentContext): Promise<void> {
    return this.listing.listAgents({
      tenantId: context.projectId,
      attempt: context.attempt,
      listing: payload,
    });
  }

  listPeople(payload: IngestionPullListingPayload, context: IntentContext): Promise<void> {
    return this.listing.listPeople({
      tenantId: context.projectId,
      attempt: context.attempt,
      listing: payload,
    });
  }
}
