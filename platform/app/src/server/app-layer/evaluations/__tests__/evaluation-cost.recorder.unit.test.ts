/**
 * `PrismaEvaluationCostRecorder` records a cost part-way through
 * `ExecuteEvaluationCommand.handle`, which runs on the GroupQueue's
 * at-least-once delivery. A failure after the cost is written but before the
 * handler completes re-runs the handler from the top. Cost rows are money —
 * `license-enforcement.repository.ts` sums them for limit enforcement and
 * `api/routers/costs.ts` reports them — so the retry must land on the row the
 * first attempt wrote, not a second one.
 *
 * The fake below is a Postgres-faithful stand-in for the `Cost` delegate: one
 * row store, and the `(projectId, idempotencyKey)` unique index the
 * 20260729090000_cost_idempotency_key migration creates, including Postgres'
 * rule that NULLs in a unique index are DISTINCT. That last part is what lets
 * the other three `prisma.cost.create` writers (topic clustering, batch
 * evaluations, the legacy single-evaluation route) keep writing many rows
 * under one business tuple, and it is why the constraint could be added to a
 * table that already contains duplicates.
 */
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { PrismaEvaluationCostRecorder } from "../evaluation-cost.recorder";

interface FakeCostRow {
  id: string;
  projectId: string;
  idempotencyKey: string | null;
  costType: string;
  costName: string | null;
  referenceType: string;
  referenceId: string;
  amount: number;
  currency: string;
  extraInfo: unknown;
}

/**
 * Minimal `prisma.cost` delegate over an array, enforcing exactly the unique
 * index the migration adds. `create`, `upsert` and `findUnique` all go through
 * the same store, so swapping the recorder between them is observable here in
 * the same way it is in Postgres.
 */
class FakeCostStore {
  readonly rows: FakeCostRow[] = [];

  private find(projectId: string, idempotencyKey: string | null) {
    // Postgres: NULLs are distinct in a unique index, so a NULL key never
    // matches an existing row.
    if (idempotencyKey === null) return undefined;
    return this.rows.find(
      (row) =>
        row.projectId === projectId && row.idempotencyKey === idempotencyKey,
    );
  }

  private insert(data: Record<string, unknown>): FakeCostRow {
    const row = {
      idempotencyKey: null,
      ...data,
    } as unknown as FakeCostRow;
    if (this.find(row.projectId, row.idempotencyKey)) {
      throw new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed on the fields: (`projectId`,`idempotencyKey`)",
        {
          code: "P2002",
          clientVersion: "test",
          meta: { target: ["projectId", "idempotencyKey"] },
        },
      );
    }
    this.rows.push(row);
    return row;
  }

  readonly cost = {
    create: async ({ data }: { data: Record<string, unknown> }) =>
      this.insert(data),

    findUnique: async ({
      where,
    }: {
      where: {
        projectId_idempotencyKey: {
          projectId: string;
          idempotencyKey: string;
        };
      };
    }) => {
      const key = where.projectId_idempotencyKey;
      return this.find(key.projectId, key.idempotencyKey) ?? null;
    },

    upsert: async ({
      where,
      create,
    }: {
      where: {
        projectId_idempotencyKey: {
          projectId: string;
          idempotencyKey: string;
        };
      };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const key = where.projectId_idempotencyKey;
      const existing = this.find(key.projectId, key.idempotencyKey);
      // `update: {}` — the recorder deliberately leaves the billed row alone.
      if (existing) return existing;
      return this.insert(create);
    },
  };
}

const PROJECT_ID = "project_abc";

const COMMAND_PAYLOAD = {
  projectId: PROJECT_ID,
  evaluationId: "eval_2fRkT1cAAAAAAAAAAAAAAAAAAAA",
  isGuardrail: false,
  evaluatorName: "Ragas Faithfulness",
  evaluatorId: "check_xyz",
  traceId: "trace_123",
  amount: 0.0042,
  currency: "USD",
};

describe("PrismaEvaluationCostRecorder", () => {
  let store: FakeCostStore;
  let recorder: PrismaEvaluationCostRecorder;

  beforeEach(() => {
    store = new FakeCostStore();
    recorder = new PrismaEvaluationCostRecorder(
      store as unknown as ConstructorParameters<
        typeof PrismaEvaluationCostRecorder
      >[0],
    );
  });

  describe("given a cost has already been recorded for an evaluation", () => {
    describe("when the same command is redelivered", () => {
      it("bills once", async () => {
        await recorder.recordCost(COMMAND_PAYLOAD);
        await recorder.recordCost(COMMAND_PAYLOAD);

        expect(store.rows).toHaveLength(1);
        expect(store.rows[0]?.amount).toBe(0.0042);
      });

      it("returns the id of the row the first attempt wrote", async () => {
        const first = await recorder.recordCost(COMMAND_PAYLOAD);
        const second = await recorder.recordCost(COMMAND_PAYLOAD);

        expect(second).toBe(first);
        expect(store.rows[0]?.id).toBe(first);
      });

      it("leaves the billed amount untouched when the retry computes a different figure", async () => {
        await recorder.recordCost(COMMAND_PAYLOAD);
        await recorder.recordCost({ ...COMMAND_PAYLOAD, amount: 99 });

        expect(store.rows).toHaveLength(1);
        expect(store.rows[0]?.amount).toBe(0.0042);
      });
    });

    describe("when a concurrent attempt loses the insert race", () => {
      it("resolves to the winning row instead of surfacing the constraint error", async () => {
        const winner = await recorder.recordCost(COMMAND_PAYLOAD);

        // Model the read-then-write race: the upsert's existence check misses
        // (the winner had not committed yet) and the insert hits the index.
        let missedOnce = false;
        const realUpsert = store.cost.upsert;
        store.cost.upsert = (async (args: Parameters<typeof realUpsert>[0]) => {
          if (!missedOnce) {
            missedOnce = true;
            return store.cost.create({ data: args.create });
          }
          return realUpsert.call(store.cost, args);
        }) as typeof realUpsert;

        await expect(recorder.recordCost(COMMAND_PAYLOAD)).resolves.toBe(
          winner,
        );
        expect(store.rows).toHaveLength(1);
      });
    });
  });

  describe("given a genuinely new evaluation of the same evaluator and trace", () => {
    describe("when it records its cost", () => {
      it("bills again", async () => {
        // The `evaluationTrigger` process manager derives the evaluationId
        // from (trace, evaluator, request generation), so a genuine re-run
        // arrives under a different id and is a separate billable unit —
        // the constraint must not collapse it into the earlier one.
        await recorder.recordCost(COMMAND_PAYLOAD);
        await recorder.recordCost({
          ...COMMAND_PAYLOAD,
          evaluationId: "eval_2fRkT1cBBBBBBBBBBBBBBBBBBBB",
        });

        expect(store.rows).toHaveLength(2);
      });
    });
  });

  describe("given another project runs the same evaluation id", () => {
    describe("when it records its cost", () => {
      it("bills separately", async () => {
        await recorder.recordCost(COMMAND_PAYLOAD);
        await recorder.recordCost({
          ...COMMAND_PAYLOAD,
          projectId: "project_def",
        });

        expect(store.rows).toHaveLength(2);
      });
    });
  });

  describe("given a writer that makes no idempotency claim", () => {
    describe("when it writes repeatedly under one business tuple", () => {
      it("keeps every row", async () => {
        // Topic clustering (CLUSTERING / PROJECT / referenceId = projectId) and
        // batch evaluations (BATCH_EVALUATION / BATCH / referenceId =
        // experimentId) both do this. They leave idempotencyKey NULL, and
        // Postgres treats NULLs as distinct, so the new index cannot reject
        // them. This is also why no historical row could block the index.
        const clusteringRow = {
          projectId: PROJECT_ID,
          costType: "CLUSTERING",
          costName: "Topics Clustering",
          referenceType: "PROJECT",
          referenceId: PROJECT_ID,
          amount: 0.5,
          currency: "USD",
          extraInfo: {},
        };

        await store.cost.create({ data: { id: "cost_1", ...clusteringRow } });
        await store.cost.create({ data: { id: "cost_2", ...clusteringRow } });

        expect(store.rows).toHaveLength(2);
      });
    });
  });
});
