import type { AnnotationApi } from "@langwatch/annotation-contract";
import {
  type Dataset,
  type DatasetApi,
  type DatasetRecord,
  DatasetNotFoundError,
  DatasetRecordConflictError,
  InvalidColumnError,
} from "@langwatch/dataset-contract";
import { refusesRetry } from "@langwatch/group-queue";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { PersistActionWriterService } from "../persist-action-writer.service.ts";

function datasetWith(columns: string[]): Dataset {
  return {
    id: "dataset-1",
    name: "qa",
    columnTypes: columns.map((name) => ({ name, type: "string" })),
  } as Dataset;
}

function writerOver(datasets: Partial<DatasetApi>) {
  const { logger, lines } = createTestLogger();
  const writer = PersistActionWriterService.create({
    datasets: createApiFixture<DatasetApi>(datasets),
    annotations: createApiFixture<AnnotationApi>(),
    logger,
  });
  const warnings = () => lines.filter((line) => line.level === 40);

  return { writer, warnings };
}

async function refusalOf(write: Promise<void>): Promise<unknown> {
  return write.then(
    () => undefined,
    (error: unknown) => error,
  );
}

const write = {
  datasetId: "dataset-1",
  projectId: "project-1",
  triggerId: "trigger-1",
  traceId: "trace-1",
  datasetRecords: [{ id: "trigger-1-trace-1-0", question: "why", input: "secret value" }],
};

/** What the dataset returns when it stored every row: enough of a record for the
 * writer's id check. */
function recordsWritten(input: Parameters<DatasetApi["batchCreateRecords"]>[0]): DatasetRecord[] {
  return input.entries.map(
    ({ id, ...entry }) =>
      ({
        id: id ?? "generated-id",
        datasetId: input.slugOrId,
        projectId: input.projectId,
        entry,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }) as DatasetRecord,
  );
}

describe("PersistActionWriterService.addToDataset", () => {
  describe("given a mapping that names a column the dataset no longer has", () => {
    /** @scenario "A stale mapping column is dropped and the row is still written" */
    it("writes the row with only the dataset's columns and warns with the dropped names", async () => {
      const appended: Parameters<DatasetApi["batchCreateRecords"]>[0][] = [];
      const { writer, warnings } = writerOver({
        findBySlugOrId: async () => datasetWith(["question"]),
        batchCreateRecords: async (input) => {
          appended.push(input);
          return recordsWritten(input);
        },
      });

      await writer.addToDataset(write);

      expect(appended.map(({ entries }) => entries)).toEqual([
        [{ id: "trigger-1-trace-1-0", question: "why" }],
      ]);
      expect(warnings()).toEqual([
        expect.objectContaining({
          triggerId: "trigger-1",
          datasetId: "dataset-1",
          droppedColumns: ["input"],
        }),
      ]);
      expect(JSON.stringify(warnings())).not.toContain("secret value");
    });

    it("does not warn when every mapped key is a column", async () => {
      const { writer, warnings } = writerOver({
        findBySlugOrId: async () => datasetWith(["question", "input"]),
        batchCreateRecords: async (input) => recordsWritten(input),
      });

      await writer.addToDataset(write);

      expect(warnings()).toEqual([]);
    });

    it("asks the dataset to skip ids an earlier attempt already wrote and read them back", async () => {
      const appended: Parameters<DatasetApi["batchCreateRecords"]>[0][] = [];
      const { writer } = writerOver({
        findBySlugOrId: async () => datasetWith(["question", "input"]),
        batchCreateRecords: async (input) => {
          appended.push(input);
          return recordsWritten(input);
        },
      });

      await writer.addToDataset(write);

      expect(appended).toEqual([
        expect.objectContaining({
          skipDuplicates: true,
          readBackExisting: true,
          verifyExisting: true,
        }),
      ]);
    });

    it("accepts a retry when the stored row still matches the mapping", async () => {
      const { writer } = writerOver({
        findBySlugOrId: async () => datasetWith(["question", "input"]),
        batchCreateRecords: async (input) => recordsWritten(input),
      });

      await expect(writer.addToDataset(write)).resolves.toBeUndefined();
    });

    it("fails terminally when a stored row no longer matches what the retry would write", async () => {
      const { writer } = writerOver({
        findBySlugOrId: async () => datasetWith(["question", "input"]),
        batchCreateRecords: async () => {
          throw new DatasetRecordConflictError("row-0");
        },
      });

      const refusal = await refusalOf(writer.addToDataset(write));

      expect(refusal).toEqual(
        expect.objectContaining({
          retryable: false,
          message: expect.stringContaining("mapping"),
        }),
      );
      expect(refusesRetry(refusal)).toBe(true);
    });
  });

  describe("given a mapping whose every column is gone", () => {
    /** @scenario "A row left with no dataset column is not written" */
    it("writes nothing, warns, and ends the dispatch as terminal", async () => {
      const appended: unknown[] = [];
      const { writer, warnings } = writerOver({
        findBySlugOrId: async () => datasetWith(["trace_id"]),
        batchCreateRecords: async (input) => {
          appended.push(input);
          return recordsWritten(input);
        },
      });

      const refusal = await refusalOf(writer.addToDataset(write));

      expect(appended).toEqual([]);
      expect(refusesRetry(refusal)).toBe(true);
      expect(warnings()).toEqual([
        expect.objectContaining({ droppedColumns: ["question", "input"] }),
      ]);
    });

    it("still writes when the mapping also names the dataset's only column", async () => {
      const appended: Parameters<DatasetApi["batchCreateRecords"]>[0][] = [];
      const { writer } = writerOver({
        findBySlugOrId: async () => datasetWith(["trace_id"]),
        batchCreateRecords: async (input) => {
          appended.push(input);
          return recordsWritten(input);
        },
      });

      await writer.addToDataset({
        ...write,
        datasetRecords: [{ id: "r-0", trace_id: "trace-1", question: "why" }],
      });

      expect(appended.map(({ entries }) => entries)).toEqual([
        [{ id: "r-0", trace_id: "trace-1" }],
      ]);
    });
  });

  describe("given the dataset refuses the write", () => {
    /** @scenario "A column removed while the rows are written is retried" */
    it("leaves a column refusal retryable", async () => {
      const { writer } = writerOver({
        findBySlugOrId: async () => datasetWith(["question", "input"]),
        batchCreateRecords: async () => {
          throw new InvalidColumnError({
            columnName: "input",
            datasetName: "qa",
            validColumns: ["question"],
          });
        },
      });

      const refusal = await refusalOf(writer.addToDataset(write));

      expect(refusal).toEqual(expect.objectContaining({ retryable: true }));
      const cause = (refusal as Error).cause;
      expect(cause).toBeInstanceOf(InvalidColumnError);
      // Rethrown as it came, the dataset's refusal would retire the message as dead.
      expect(refusesRetry(cause)).toBe(true);
      expect(refusesRetry(refusal)).toBe(false);
    });

    /** @scenario "A dataset that is gone or archived is not retried" */
    it("treats a dataset that is gone, before or during the write, as terminal", async () => {
      const gone = writerOver({ findBySlugOrId: async () => null });
      const goneRefusal = await refusalOf(gone.writer.addToDataset(write));
      const datasetGone = new DatasetNotFoundError();
      const raced = writerOver({
        findBySlugOrId: async () => datasetWith(["question"]),
        batchCreateRecords: async () => {
          throw datasetGone;
        },
      });
      const racedRefusal = await refusalOf(raced.writer.addToDataset(write));

      for (const refusal of [goneRefusal, racedRefusal]) {
        expect(refusal).toEqual(
          expect.objectContaining({ code: "automation_dataset_unavailable", fault: "customer" }),
        );
        expect(refusesRetry(refusal)).toBe(true);
      }
      expect(racedRefusal).toEqual(expect.objectContaining({ reasons: [datasetGone] }));
      // The settlement logs the refusal once; the writer adds no line of its own.
      expect(gone.warnings()).toEqual([]);
    });

    it("leaves a failure the dataset did not name retryable", async () => {
      const outage = new Error("connection reset");
      const { writer } = writerOver({
        findBySlugOrId: async () => datasetWith(["question"]),
        batchCreateRecords: async () => {
          throw outage;
        },
      });

      const refusal = await refusalOf(writer.addToDataset(write));

      expect(refusal).toBe(outage);
      expect(refusesRetry(refusal)).toBe(false);
    });
  });

  describe("given an id that already belongs to another dataset", () => {
    it("fails terminally instead of reporting a row that was not added", async () => {
      const { writer } = writerOver({
        findBySlugOrId: async () => datasetWith(["question", "input"]),
        // A globally unique id in another dataset is skipped, so the readback omits it.
        batchCreateRecords: async () => [],
      });

      const refusal = await refusalOf(writer.addToDataset(write));

      expect(refusal).toEqual(
        expect.objectContaining({
          retryable: false,
          message: expect.stringContaining("already belongs to another dataset"),
        }),
      );
      expect(refusesRetry(refusal)).toBe(true);
    });

    it("names the ids the dataset could not store in the requested dataset", async () => {
      const { writer } = writerOver({
        findBySlugOrId: async () => datasetWith(["question"]),
        batchCreateRecords: async (input) =>
          recordsWritten(input).filter((record) => record.id === "r-0"),
      });

      const refusal = await refusalOf(
        writer.addToDataset({
          ...write,
          datasetRecords: [
            { id: "r-0", question: "first" },
            { id: "r-1", question: "second" },
          ],
        }),
      );

      expect(refusal).toEqual(
        expect.objectContaining({
          retryable: false,
          message: expect.stringContaining("r-1"),
        }),
      );
    });
  });
});
