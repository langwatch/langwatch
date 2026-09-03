import { z } from "zod";

const eventingRetentionConfigurationSchema = z.object({
  defaultRetentionDays: z.number().int().positive(),
});

/** Validated, process-injected fallback for rows without a tenant override. */
export type EventingRetentionConfiguration = Readonly<{
  defaultRetentionDays: number;
}>;

export function createEventingRetentionConfiguration(input: {
  defaultRetentionDays: number;
}): EventingRetentionConfiguration {
  return eventingRetentionConfigurationSchema.parse(input);
}
