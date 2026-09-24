import { z } from "zod";

export const scimSsoMigrationFinalizedEventSchema = z.object({
  data: z.object({ connectionId: z.string() }),
});

export type ScimSsoMigrationFinalizedEvent = z.infer<typeof scimSsoMigrationFinalizedEventSchema>;

export const scimSsoMigrationSubscriberContextSchema = z.object({ tenantId: z.string() });

export type ScimSsoMigrationSubscriberContext = z.infer<
  typeof scimSsoMigrationSubscriberContextSchema
>;

/**
 * Directory sync's event-subscriber lifecycle for a finished move to an
 * organization's own identity provider, hosted on identity's connection
 * pipeline, which owns redelivery and deduplication.
 */
export abstract class ScimSsoMigrationSubscriberService {
  abstract handleMigrationFinalized(
    event: ScimSsoMigrationFinalizedEvent,
    context: ScimSsoMigrationSubscriberContext,
  ): Promise<void>;
}
