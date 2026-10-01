import { z } from "zod";

const normalizeTarget = {
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
  filename: z.string().min(1),
};

/**
 * Durable payload for Dataset's normalization worker lane. The `stagingKey`
 * form was queued by the previous release and is read for one more (ADR-155).
 */
export const datasetNormalizePayloadSchema = z.union([
  z.object({ ...normalizeTarget, sourceStoredObjectId: z.string().min(1) }),
  z.object({ ...normalizeTarget, stagingKey: z.string().min(1) }),
]);

export type DatasetNormalizePayload = z.infer<typeof datasetNormalizePayloadSchema>;
