// @vitest-environment node

/**
 * Leg 4 — datasets: created with columns, filled, amended and deleted, with
 * every step read back from the platform rather than from the write.
 */
import { afterAll, describe, expect, it } from "vitest";

import { type LangWatch } from "../../../dist";
import { client, unique } from "./support/journey";

const COLUMNS = [
  { name: "question", type: "string" },
  { name: "answer", type: "string" },
];

describe("given an application that keeps a dataset on the platform", () => {
  const langwatch: LangWatch = client();
  const toRemove: string[] = [];

  afterAll(async () => {
    for (const each of toRemove) {
      await langwatch.datasets.delete(each).catch(() => undefined);
    }
  });

  describe("when it creates a dataset, fills it and amends a record", () => {
    // @scenario "A dataset is created, filled, amended and deleted"
    it("creates, fills, amends and deletes the dataset", async () => {
      const name = unique("sdk-app-dataset");
      const dataset = await langwatch.datasets.create({ name, columnTypes: COLUMNS });
      toRemove.push(dataset.id);

      expect(dataset.name).toBe(name);
      expect(dataset.columnTypes.map((column) => column.name)).toEqual(["question", "answer"]);

      await langwatch.datasets.createRecords(dataset.id, [
        { question: "What is a span?", answer: "One step of a trace." },
        { question: "What is a trace?", answer: "One request, end to end." },
      ]);

      const records = await langwatch.datasets.listRecords(dataset.id);
      expect(records.data).toHaveLength(2);

      const first = records.data.find(
        (record) => (record.entry as { question?: string }).question === "What is a span?",
      );
      expect(first).toBeDefined();

      await langwatch.datasets.updateRecord(dataset.id, first!.id, {
        question: "What is a span?",
        answer: "One unit of work inside a trace.",
      });

      const amended = await langwatch.datasets.listRecords(dataset.id);
      const changed = amended.data.find((record) => record.id === first!.id);
      expect((changed?.entry as { answer?: string }).answer).toBe(
        "One unit of work inside a trace.",
      );

      await langwatch.datasets.delete(dataset.id);
      toRemove.length = 0;

      const listed = await langwatch.datasets.list();
      expect(listed.data.map((each) => each.id)).not.toContain(dataset.id);
    }, 120_000);
  });

  describe("when it adds a record naming a column the dataset does not have", () => {
    // @scenario "Adding a record whose columns do not match the dataset is refused"
    it("has the platform refuse the record", async () => {
      const dataset = await langwatch.datasets.create({
        name: unique("sdk-app-dataset-mismatch"),
        columnTypes: COLUMNS,
      });
      toRemove.push(dataset.id);

      await expect(
        langwatch.datasets.createRecords(dataset.id, [{ unexpected: "no such column" }]),
      ).rejects.toThrow();
    }, 90_000);
  });
});
