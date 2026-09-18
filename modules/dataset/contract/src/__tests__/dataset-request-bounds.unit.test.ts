import { resolveRequestBound } from "@langwatch/plans";
/**
 * The registry enterprise ceiling is the outer validation shell for dataset
 * batches: entries and recordIds arrays above 4000 refuse at the schema.
 * The application refuses above the caller's tier through the entitlement peer.
 */
import { describe, expect, it } from "vitest";

import {
  datasetRestBatchCreateRecordsSchema,
  datasetRestDeleteRecordsSchema,
  datasetRestLegacyEntriesSchema,
} from "../dataset-rest.schemas.ts";
import { datasetRecordApiDeleteManyInputSchema } from "../dataset.schemas.ts";
import { newDatasetEntriesSchema } from "../dataset.ts";

const ENTERPRISE_BATCH = resolveRequestBound("datasetBatchMax", "ENTERPRISE");

const entries = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ input: `row ${index}` }));

describe("dataset batch schemas", () => {
  it.each([
    ["datasetRestBatchCreateRecordsSchema", datasetRestBatchCreateRecordsSchema],
    ["datasetRestLegacyEntriesSchema", datasetRestLegacyEntriesSchema],
  ] as const)("%s refuses entries above the enterprise ceiling", (_name, schema) => {
    expect(schema.safeParse({ entries: entries(ENTERPRISE_BATCH + 1) }).success).toBe(false);
    expect(schema.safeParse({ entries: entries(ENTERPRISE_BATCH) }).success).toBe(true);
  });

  it("datasetRestLegacyEntriesSchema refuses an empty entries array now", () => {
    expect(datasetRestLegacyEntriesSchema.safeParse({ entries: [] }).success).toBe(false);
  });

  it("datasetRestDeleteRecordsSchema refuses recordIds above the enterprise ceiling", () => {
    const recordIds = (count: number) => Array.from({ length: count }, (_, i) => `r${i}`);

    expect(
      datasetRestDeleteRecordsSchema.safeParse({ recordIds: recordIds(ENTERPRISE_BATCH + 1) })
        .success,
    ).toBe(false);
    expect(
      datasetRestDeleteRecordsSchema.safeParse({ recordIds: recordIds(ENTERPRISE_BATCH) }).success,
    ).toBe(true);
  });

  it("newDatasetEntriesSchema refuses entries above the enterprise ceiling", () => {
    const idEntries = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, input: `row ${index}` }));

    expect(
      newDatasetEntriesSchema.safeParse({ entries: idEntries(ENTERPRISE_BATCH + 1) }).success,
    ).toBe(false);
    expect(
      newDatasetEntriesSchema.safeParse({ entries: idEntries(ENTERPRISE_BATCH) }).success,
    ).toBe(true);
  });

  it("datasetRecordApiDeleteManyInputSchema refuses recordIds above the enterprise ceiling", () => {
    const recordIds = (count: number) => Array.from({ length: count }, (_, i) => `r${i}`);
    const input = (count: number) =>
      datasetRecordApiDeleteManyInputSchema.safeParse({
        projectId: "p1",
        datasetId: "d1",
        recordIds: recordIds(count),
      });

    expect(input(ENTERPRISE_BATCH + 1).success).toBe(false);
    expect(input(ENTERPRISE_BATCH).success).toBe(true);
  });
});
