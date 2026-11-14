/**
 * `saveActive`, the write behind the batch evaluation log's find-or-create: it never writes an
 * archived experiment, and it runs without an interactive transaction, whose 5 s timeout a slow
 * pool turned into a 500 on `POST /api/evaluations/batch/log_results`.
 */
import { Prisma } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";

import { ArchivedExperimentWriteError } from "../../experiment.repository.ts";
import { PrismaExperimentRepository } from "../prisma.experiment.repository.ts";

type Row = {
  id: string;
  projectId: string;
  name: string | null;
  type: string;
  slug: string;
  workflowId: string | null;
  workbenchState: unknown;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  workbenchVersion: number;
};

type Where = { id: string; projectId: string; archivedAt?: null };
type Fields = Pick<Row, "name" | "type" | "slug" | "workflowId" | "workbenchState">;

/** What Postgres hands back for a written `Prisma.JsonNull`. */
const stored = <T extends Partial<Fields>>(data: T): T =>
  data.workbenchState === Prisma.JsonNull ? { ...data, workbenchState: null } : data;

/** The experiment table over a map, recording whether a write opened a transaction. */
function databaseOver(seed: Row[]) {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  const calls = { transactions: 0 };
  const matches = (row: Row | undefined, where: Where): row is Row =>
    row !== undefined &&
    row.projectId === where.projectId &&
    (where.archivedAt !== null || row.archivedAt === null);
  const insert = (data: Fields & { id: string; projectId: string }) => {
    if (rows.has(data.id)) {
      throw Object.assign(new Error("Unique constraint failed on the fields: (`id`)"), {
        code: "P2002",
        meta: { target: ["id"] },
      });
    }
    const row: Row = {
      ...stored(data),
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      workbenchVersion: 0,
    };
    rows.set(row.id, row);
    return { ...row };
  };
  const experiment = {
    findUnique: async ({ where }: { where: Where }) => {
      const row = rows.get(where.id);
      return matches(row, where) ? { ...row } : null;
    },
    upsert: async (args: { where: Where; create: Fields & Where; update: Fields }) => {
      const row = rows.get(args.where.id);
      if (!matches(row, args.where)) return insert(args.create);
      Object.assign(row, stored(args.update));
      return { ...row };
    },
    updateManyAndReturn: async ({ where, data }: { where: Where; data: Fields }) => {
      const row = rows.get(where.id);
      if (!matches(row, where)) return [];
      Object.assign(row, stored(data));
      return [{ ...row }];
    },
    create: async ({ data }: { data: Fields & { id: string; projectId: string } }) => insert(data),
  };
  const database = {
    experiment,
    $transaction: async <T>(
      work: (transaction: { experiment: typeof experiment }) => Promise<T>,
    ) => {
      calls.transactions += 1;
      return work({ experiment });
    },
  };

  return { rows, calls, repository: PrismaExperimentRepository.create(database as never) };
}

const ACTIVE: Row = {
  id: "experiment_test",
  projectId: "project_test",
  name: "Batch run",
  type: "BATCH_EVALUATION_V2",
  slug: "batch-run",
  workflowId: null,
  workbenchState: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  workbenchVersion: 0,
};

const SAVE = {
  id: ACTIVE.id,
  projectId: ACTIVE.projectId,
  name: "Renamed run",
  type: "BATCH_EVALUATION_V2" as const,
  requestedSlug: ACTIVE.slug,
  slugMode: "preserve-existing" as const,
  slug: ACTIVE.slug,
  workflowId: null,
  workbenchState: null,
};

describe("PrismaExperimentRepository.saveActive", () => {
  describe("given an active experiment", () => {
    describe("when the batch log saves it", () => {
      it("updates it without an interactive transaction", async () => {
        const { repository, rows, calls } = databaseOver([ACTIVE]);

        const saved = await repository.saveActive(SAVE);

        expect(saved.name).toBe("Renamed run");
        expect(rows.get(ACTIVE.id)?.name).toBe("Renamed run");
        expect(calls.transactions).toBe(0);
      });
    });
  });

  describe("given no experiment with that id", () => {
    describe("when the batch log saves it", () => {
      it("creates it without an interactive transaction", async () => {
        const { repository, rows, calls } = databaseOver([]);

        const saved = await repository.saveActive(SAVE);

        expect(saved.id).toBe(ACTIVE.id);
        expect(rows.get(ACTIVE.id)?.name).toBe("Renamed run");
        expect(calls.transactions).toBe(0);
      });
    });
  });

  describe("given an archived experiment", () => {
    describe("when the batch log saves it", () => {
      it("refuses the write and leaves the row as it was", async () => {
        const archived = { ...ACTIVE, archivedAt: new Date(1) };
        const { repository, rows } = databaseOver([archived]);

        const refusal = await repository.saveActive(SAVE).catch((error: unknown) => error);

        expect(refusal).toBeInstanceOf(ArchivedExperimentWriteError);
        expect(rows.get(ACTIVE.id)?.name).toBe("Batch run");
      });
    });
  });

  describe("given the id belongs to an experiment in another project", () => {
    describe("when the batch log saves it", () => {
      it("leaves that experiment alone", async () => {
        const foreign = { ...ACTIVE, projectId: "project_other" };
        const { repository, rows } = databaseOver([foreign]);

        await repository.saveActive(SAVE).catch(() => void 0);

        expect(rows.get(ACTIVE.id)).toMatchObject({
          projectId: "project_other",
          name: "Batch run",
        });
      });
    });
  });
});
