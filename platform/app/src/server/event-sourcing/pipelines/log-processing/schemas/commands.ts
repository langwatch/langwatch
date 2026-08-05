import { canonicalLogRecordSchema } from "./logRecord";

export const recordCanonicalLogCommandDataSchema = canonicalLogRecordSchema;
export type RecordCanonicalLogCommandData = ReturnType<
  typeof recordCanonicalLogCommandDataSchema.parse
>;
