import { z } from "zod";

/** Durable staged payload for Dataset's normalization worker lane. */
export const datasetNormalizePayloadSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
  stagingKey: z.string().min(1),
  filename: z.string().min(1),
});

export type DatasetNormalizePayload = z.infer<typeof datasetNormalizePayloadSchema>;

export type DatasetNormalizationSender = (payload: DatasetNormalizePayload) => Promise<void>;

/** Dataset-owned process port for the durable normalization worker lane. */
export abstract class DatasetNormalizationWorkerPort {
  abstract process(payload: DatasetNormalizePayload): Promise<void>;
  abstract connect(sender: DatasetNormalizationSender): void;
}
