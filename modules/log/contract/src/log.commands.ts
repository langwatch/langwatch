import { z } from "zod";
import { canonicalLogRecordSchema } from "./log-record.ts";

export const recordCanonicalLogCommandDataSchema = canonicalLogRecordSchema;
export type RecordCanonicalLogCommandData = z.infer<typeof recordCanonicalLogCommandDataSchema>;
