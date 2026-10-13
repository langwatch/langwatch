import { z } from "zod";

import { assertNoTraversal } from "./dataset-chunking.rules.ts";

/** One record as the previous release stored it in a single-file dataset's JSON array. */
const singleFileRecordSchema = z.object({
  id: z.string().optional(),
  entry: z.record(z.string(), z.unknown()),
});

export type SingleFileRecord = z.infer<typeof singleFileRecordSchema>;

/** The previous release's object key for a single-file dataset (its `storage.ts`). */
export function singleFileKey(input: { projectId: string; datasetId: string }): string {
  assertNoTraversal(input.projectId, input.datasetId);
  return `datasets/${input.projectId}/${input.datasetId}`;
}

/** A single-file dataset's records in stored order, or `unreadable` when not that array. */
export function parseSingleFileRecords(
  text: string,
): { outcome: "parsed"; records: SingleFileRecord[] } | { outcome: "unreadable" } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { outcome: "unreadable" };
  }
  const parsed = z.array(singleFileRecordSchema).safeParse(json);
  return parsed.success ? { outcome: "parsed", records: parsed.data } : { outcome: "unreadable" };
}

/** A single-file dataset the content move left in place, and why. */
const skippedSingleFileSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  reason: z.enum(["missing", "unreadable"]),
});

export type SkippedSingleFile = z.infer<typeof skippedSingleFileSchema>;

/** The skipped list a saved checkpoint carried, so a resumed run still reports it. */
export function parseSkippedSingleFiles(value: unknown): SkippedSingleFile[] {
  const parsed = z.array(skippedSingleFileSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}
