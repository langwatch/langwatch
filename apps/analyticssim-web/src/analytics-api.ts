import { SimFetchError, simFetch } from "@langwatch/sim-console";
import { z } from "zod";

export const providers = ["posthog", "customerio"] as const;
export const kinds = ["identify", "event", "alias", "group"] as const;

export const recordSchema = z.object({
  id: z.string(),
  provider: z.enum(providers),
  kind: z.enum(kinds),
  distinctId: z.string(),
  name: z.string().optional(),
  /** Go encodes a nil map as null; the console reads both as no properties. */
  properties: z
    .record(z.string(), z.unknown())
    .nullable()
    .transform((properties) => properties ?? {}),
  receivedAt: z.coerce.date(),
  raw: z.unknown(),
});
export type AnalyticsRecord = z.infer<typeof recordSchema>;

export const statusSchema = z.object({
  stack: z.string(),
  records: z.number(),
  baseUrl: z.string(),
});

const recordsSchema = z.object({
  records: z
    .array(recordSchema)
    .nullable()
    .transform((records) => records ?? []),
});

export const fetchStatus = () => simFetch({ path: "/_sim/api/status", schema: statusSchema });

export const fetchRecords = async () =>
  (await simFetch({ path: "/_sim/api/records", schema: recordsSchema })).records;

export const clearRecords = async () => {
  const response = await fetch("/_sim/api/records", { method: "DELETE" });
  if (!response.ok) {
    throw new SimFetchError({ status: response.status, message: "Clearing the records failed." });
  }
};
