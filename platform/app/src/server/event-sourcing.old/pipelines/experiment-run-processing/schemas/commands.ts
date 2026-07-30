import type { SerializedHandledError } from "@langwatch/handled-error";
import { z } from "zod";
import { targetSchema } from "./shared";

const recordTargetResultCommandDataSchema = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  index: z.number(),
  targetId: z.string(),
  entry: z.record(z.unknown()),
  predicted: z.record(z.unknown()).nullable().optional(),
  cost: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  /**
   * The failure's stable code, as the serialised handled error the SSE frame
   * carries. Without it the row keeps only `error` — the engine's raw string —
   * and the grid prints that to the customer on the next page load. See
   * `targetResultEventDataSchema`, which this envelope mirrors.
   */
  domainError: z
    .custom<SerializedHandledError>(
      (value) => typeof value === "object" && value !== null,
    )
    .nullable()
    .optional(),
  traceId: z.string().nullable().optional(),
  targets: z.array(targetSchema).optional(),
  occurredAt: z.number(),
});

export type RecordTargetResultCommandData = z.infer<
  typeof recordTargetResultCommandDataSchema
>;
