/**
 * The serving processes the roster holds alive: role, image and release only, for a staff
 * investigation of what runs where (ADR-202). Spec: modules/ops/specs/upgrades.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** One live serving process; times are epoch milliseconds. No process id or host. */
const opsServingProcessSchemaDefinition = z.object({
  role: z.string(),
  image: z.string(),
  release: z.string().nullable(),
  startedAt: z.number().int(),
  lastSeenAt: z.number().int(),
});
export interface OpsServingProcessSchema extends Named<typeof opsServingProcessSchemaDefinition> {}
export const opsServingProcessSchema: OpsServingProcessSchema = opsServingProcessSchemaDefinition;
export type OpsServingProcess = z.infer<typeof opsServingProcessSchema>;
