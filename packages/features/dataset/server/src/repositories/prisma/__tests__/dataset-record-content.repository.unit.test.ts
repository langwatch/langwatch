/**
 * Every write a dataset record goes through, and the scope each one carries.
 *
 * Dataset records are project-level rows, so every statement here has to name
 * both the project and the dataset — a write scoped by record id alone would
 * reach across either boundary. That is the property under test; the entry
 * payload is checked alongside it because these methods exist to carry it.
 *
 * The client is a fake that records what it was asked, since the claim is about
 * the statement issued rather than about what a database does with it.
 */

import { describe, expect, it } from "vitest";
import { DatasetRecordContentRepository } from "../dataset-record-content.repository";

type Call = { method: string; args: Record<string, unknown> };

function repositoryWith(rows: Array<Record<string, unknown>> = []) {
  const calls: Call[] = [];
  const record = (method: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    return method === "findMany"
      ? rows
      : method === "deleteMany"
        ? { count: rows.length }
        : rows[0];
  };
  const prisma = {
    datasetRecord: {
      update: record("update"),
      create: record("create"),
      createMany: record("createMany"),
      findMany: record("findMany"),
      deleteMany: record("deleteMany"),
    },
  };

  return { calls, repository: DatasetRecordContentRepository.create(prisma as never) };
}

const SCOPE = { datasetId: "dataset-1", projectId: "project-1" };

describe("DatasetRecordContentRepository", () => {
  describe("given a record being edited", () => {
    describe("when the entry is written", () => {
      it("scopes the update to the record, its dataset and its project", async () => {
        const { repository, calls } = repositoryWith([{ id: "record-1" }]);

        await repository.updateEntry({ id: "record-1", ...SCOPE, entry: { a: 1 } });

        expect(calls[0]?.args.where).toEqual({
          id: "record-1",
          datasetId: "dataset-1",
          projectId: "project-1",
        });
      });

      it("writes the entry it was given", async () => {
        const { repository, calls } = repositoryWith([{ id: "record-1" }]);

        await repository.updateEntry({ id: "record-1", ...SCOPE, entry: { a: 1 } });

        expect(calls[0]?.args.data).toEqual({ entry: { a: 1 } });
      });
    });
  });

  describe("given a record being created", () => {
    describe("when it is written", () => {
      it("carries the entry and both scope ids onto the row", async () => {
        const { repository, calls } = repositoryWith([{ id: "record-1" }]);

        await repository.create({ id: "record-1", ...SCOPE, entry: { a: 1 } });

        expect(calls[0]?.args.data).toEqual({
          id: "record-1",
          entry: { a: 1 },
          datasetId: "dataset-1",
          projectId: "project-1",
        });
      });
    });
  });

  describe("given several records being created at once", () => {
    describe("when they are written", () => {
      it("stamps every row with both scope ids", async () => {
        const { repository, calls } = repositoryWith([]);

        await repository.createMany({
          records: [
            { id: "record-1", entry: { a: 1 } },
            { id: "record-2", entry: { a: 2 } },
          ],
          ...SCOPE,
        });

        expect(calls[0]?.args.data).toEqual([
          { id: "record-1", entry: { a: 1 }, datasetId: "dataset-1", projectId: "project-1" },
          { id: "record-2", entry: { a: 2 }, datasetId: "dataset-1", projectId: "project-1" },
        ]);
      });

      it("reads them back within the same scope, oldest first", async () => {
        const { repository, calls } = repositoryWith([]);

        await repository.createMany({
          records: [{ id: "record-1", entry: { a: 1 } }],
          ...SCOPE,
        });

        const read = calls.find((call) => call.method === "findMany");
        expect(read?.args.where).toEqual({
          id: { in: ["record-1"] },
          datasetId: "dataset-1",
          projectId: "project-1",
        });
        expect(read?.args.orderBy).toEqual({ createdAt: "asc" });
      });
    });
  });

  describe("given records being deleted", () => {
    describe("when the delete is issued", () => {
      it("scopes it to the named ids within one dataset and project", async () => {
        const { repository, calls } = repositoryWith([]);

        await repository.deleteMany({ recordIds: ["record-1", "record-2"], ...SCOPE });

        expect(calls[0]?.args.where).toEqual({
          id: { in: ["record-1", "record-2"] },
          datasetId: "dataset-1",
          projectId: "project-1",
        });
      });
    });
  });
});
