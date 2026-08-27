import {
  EvaluationService,
  type EvaluationExecutionResult,
  type ExecuteEvaluationCommand,
  type ExecuteEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import {
  EvaluationInputsOffloadPort,
  EvaluationReportedEventService,
} from "@langwatch/evaluation-server/internal";
import { Prisma } from "~/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  EvaluationCostPersistence,
  type EvaluationCostWrite,
  PrismaEvaluationCostRecorder,
} from "~/server/app-layer/evaluations/evaluation-cost.recorder";
import type {
  IdempotencyReceiptCreateInput,
  IdempotencyReceiptPersistence,
  IdempotencyReceiptUpdateInput,
} from "~/server/api/idempotency";
import { AppEvaluationExecutionReceiptPort } from "~/runtime/app/features/evaluation-execution-receipt.adapter";

type ReceiptRecord = {
  id: string;
  scopeId: string;
  key: string;
  claimId: string;
  requestFingerprint: string;
  responseStatus: number | null;
  responseBody: string | null;
  createdAt: Date;
  heartbeatAt: Date;
  expiresAt: Date;
};

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("conflict", {
    code,
    clientVersion: "test",
  });
}

class DurableCostPersistence extends EvaluationCostPersistence {
  readonly writes: EvaluationCostWrite[] = [];
  readonly reusedIds: string[] = [];
  readonly rows = new Map<string, { id: string }>();
  p2002Count = 0;

  async create(input: EvaluationCostWrite): Promise<void> {
    this.writes.push(input);
    if (this.rows.has(input.id)) {
      this.p2002Count += 1;
      throw knownRequestError("P2002");
    }
    this.rows.set(input.id, { id: input.id });
  }

  async tryGetId(input: { id: string }): Promise<string | null> {
    this.reusedIds.push(input.id);
    return this.rows.get(input.id)?.id ?? null;
  }
}

function durableReceiptStorage() {
  const receipts = new Map<string, ReceiptRecord>();
  const costs = new DurableCostPersistence();
  let loseFirstFinalization = true;

  const idempotencyReceipt = {
    create: vi.fn(
      async ({ data }: { data: IdempotencyReceiptCreateInput; select: { id: true } }) => {
        const key = `${data.scopeId}:${data.key}`;
        if (receipts.has(key)) throw knownRequestError("P2002");
        const row: ReceiptRecord = {
          ...data,
          id: `receipt-${receipts.size + 1}`,
          responseStatus: null,
          responseBody: null,
          createdAt: new Date(),
        };
        receipts.set(key, row);
        return { id: row.id };
      },
    ),
    findUnique: vi.fn(
      async ({ where }: { where: { scopeId_key: { scopeId: string; key: string } } }) =>
        receipts.get(`${where.scopeId_key.scopeId}:${where.scopeId_key.key}`) ?? null,
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; claimId?: string; responseStatus?: null };
        data: IdempotencyReceiptUpdateInput;
      }) => {
        const row = [...receipts.values()].find(
          (candidate) =>
            (where.id === undefined || candidate.id === where.id) &&
            (where.claimId === undefined || candidate.claimId === where.claimId) &&
            (where.responseStatus === undefined ||
              candidate.responseStatus === where.responseStatus),
        );
        if (!row) return { count: 0 };

        if (data.responseStatus !== undefined && loseFirstFinalization) {
          loseFirstFinalization = false;
          return { count: 0 };
        }

        if (data.claimId !== undefined) row.claimId = data.claimId;
        if (data.heartbeatAt !== undefined) row.heartbeatAt = data.heartbeatAt;
        if (data.expiresAt !== undefined) row.expiresAt = data.expiresAt;
        if (data.responseStatus !== undefined) row.responseStatus = data.responseStatus;
        if (data.responseBody !== undefined) row.responseBody = data.responseBody;
        return { count: 1 };
      },
    ),
    deleteMany: vi.fn(async (_input: { where: { id: string; claimId?: string } }) => ({
      count: 0,
    })),
  };

  const receiptStore = { idempotencyReceipt } satisfies IdempotencyReceiptPersistence;

  return {
    receiptStore,
    receipts,
    costs,
    makeClaimStale() {
      const receipt = receipts.values().next().value;
      if (!receipt) throw new Error("expected an idempotency receipt");
      receipt.heartbeatAt = new Date(Date.now() - 30_000);
    },
    idempotencyReceipt,
  };
}

class TestEvaluationService extends EvaluationService {
  readonly commands: ExecuteEvaluationCommand[] = [];

  constructor(private readonly result: EvaluationExecutionResult) {
    super();
  }

  async executeForTrace(input: ExecuteEvaluationCommand): Promise<EvaluationExecutionResult> {
    this.commands.push(input);
    return this.result;
  }
}

class TestInputsOffloadPort extends EvaluationInputsOffloadPort {
  offload(input: {
    tenantId: string;
    evaluationId: string;
    inputs: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return Promise.resolve(input.inputs);
  }
}

const executeCommand: ExecuteEvaluationCommand = {
  projectId: "project-retry",
  traceId: "trace-retry",
  evaluatorType: "langevals/llm_answer_match",
  settings: {},
  mappings: null,
  idempotencyKey: "project-retry:evaluation-retry:execution",
};

const reportedCommand: ExecuteEvaluationCommandData = {
  tenantId: "project-retry",
  traceId: "trace-retry",
  evaluationId: "evaluation-retry",
  evaluatorId: "evaluator-retry",
  evaluatorType: "langevals/llm_answer_match",
  occurredAt: 1_750_000_000_000,
};

describe("AppEvaluationExecutionReceiptPort", () => {
  it("reuses the persisted production Cost after a lost receipt finalisation", async () => {
    const storage = durableReceiptStorage();
    const result = {
      status: "processed" as const,
      score: 0.9,
      passed: true,
      cost: { amount: 0.012, currency: "USD" },
    } satisfies EvaluationExecutionResult;
    const evaluations = new TestEvaluationService(result);
    const costs = PrismaEvaluationCostRecorder.createWithPersistence(storage.costs);
    const receipt = AppEvaluationExecutionReceiptPort.create({
      prisma: storage.receiptStore,
      evaluations,
      costs,
    });
    const input = {
      tenantId: "project-retry",
      evaluationId: "evaluation-retry",
      operationKey: "project-retry:evaluation-retry:execution",
      command: executeCommand,
      cost: {
        isGuardrail: false,
        evaluatorName: "Retry evaluator",
        evaluatorId: "evaluator-retry",
        traceId: "trace-retry",
      },
    };

    const first = await receipt.execute(input);
    storage.makeClaimStale();
    const retry = await receipt.execute(input);

    expect(storage.costs.rows).toHaveLength(1);
    expect(storage.costs.writes).toHaveLength(2);
    expect(storage.costs.p2002Count).toBe(1);
    expect(storage.costs.reusedIds).toEqual([first.costId]);
    expect(retry.costId).toBe(first.costId);
    expect(evaluations.commands.map((command) => command.idempotencyKey)).toEqual([
      "project-retry:evaluation-retry:execution",
      "project-retry:evaluation-retry:execution",
    ]);
    expect([...storage.receipts.values()]).toEqual([
      expect.objectContaining({ responseStatus: 200, responseBody: expect.any(String) }),
    ]);

    const inputsOffload = new TestInputsOffloadPort();
    const reportedEvents = EvaluationReportedEventService.create(inputsOffload);
    const firstReport = await reportedEvents.emit(reportedCommand, {
      status: "processed",
      score: result.score,
      passed: result.passed,
      costId: first.costId,
    });
    const retryReport = await reportedEvents.emit(reportedCommand, {
      status: "processed",
      score: result.score,
      passed: result.passed,
      costId: retry.costId,
    });

    expect(retryReport[0]?.idempotencyKey).toBe(firstReport[0]?.idempotencyKey);
  });
});
