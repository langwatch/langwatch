import { z } from "zod";

export const governanceOcsfExportRowSchema = z.object({
  eventId: z.string(),
  ocsfSchemaVersion: z.string(),
  traceId: z.string(),
  sourceId: z.string(),
  sourceType: z.string(),
  classUid: z.number().int(),
  categoryUid: z.number().int(),
  activityId: z.number().int(),
  typeUid: z.number().int(),
  severityId: z.number().int(),
  eventTimeMs: z.number().int().nonnegative(),
  actorUserId: z.string(),
  actorEmail: z.string(),
  actorEnduserId: z.string(),
  actionName: z.string(),
  targetName: z.string(),
  anomalyAlertId: z.string(),
  rawOcsfJson: z.string(),
});
export type GovernanceOcsfExportRow = z.infer<typeof governanceOcsfExportRowSchema>;

export const governanceOcsfExportPageSchema = z.object({
  events: z.array(governanceOcsfExportRowSchema),
  nextCursor: z.number().int().nonnegative().nullable(),
  nextCursorCompound: z
    .object({ eventTimeMs: z.number().int().nonnegative(), eventId: z.string() })
    .nullable(),
});
export type GovernanceOcsfExportPage = z.infer<typeof governanceOcsfExportPageSchema>;

export const governanceOcsfExportInputSchema = z
  .object({
    organizationId: z.string().min(1),
    sinceMs: z.number().int().nonnegative(),
    sinceEventId: z.string().optional(),
    limit: z.number().int().min(1).max(1_000),
  })
  .strict();
export type GovernanceOcsfExportInput = z.infer<typeof governanceOcsfExportInputSchema>;

export abstract class GovernanceOcsfExportService {
  abstract list(input: GovernanceOcsfExportInput): Promise<GovernanceOcsfExportPage>;
}
