import { Prisma, type PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditDedupKey,
  type CadenceStagePayload,
  TRIGGER_NOTIFY_REACTOR_NAME,
} from "../payload";
import { PgOutboxAuditAdapter } from "../pgAuditAdapter";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const PROJECT_ID = "proj-1";
const TRIGGER_ID = "trig-1";
const TRACE_ID = "trace-1";
const DEDUP_KEY = auditDedupKey({
  projectId: PROJECT_ID,
  triggerId: TRIGGER_ID,
  traceId: TRACE_ID,
});

function makeCadencePayload(
  overrides: Partial<CadenceStagePayload> = {},
): CadenceStagePayload {
  return {
    stage: "cadence",
    projectId: PROJECT_ID,
    triggerId: TRIGGER_ID,
    reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
    auditDedupKey: DEDUP_KEY,
    match: { traceId: TRACE_ID, input: "in", output: "out" },
    ...overrides,
  };
}

function makePrismaStub() {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  return {
    updateMany,
    prisma: {
      reactorOutbox: { updateMany },
    } as unknown as PrismaClient,
  };
}

describe("PgOutboxAuditAdapter.onDispatched render-diagnostics (ADR-029)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a cadence dispatch whose render surfaced missing variables", () => {
    describe("when onDispatched fires", () => {
      it("writes the payload's renderDiagnostics to the row", async () => {
        const { prisma, updateMany } = makePrismaStub();
        const adapter = new PgOutboxAuditAdapter(prisma);
        const payload = makeCadencePayload({
          renderDiagnostics: { missingVariables: ["project.nmae"] },
        });

        await adapter.onDispatched({ payload, at: new Date(), attempt: 1 });

        expect(updateMany).toHaveBeenCalledTimes(1);
        const arg = updateMany.mock.calls[0]![0];
        expect(arg.data.status).toBe("dispatched");
        expect(arg.data.renderDiagnostics).toEqual({
          missingVariables: ["project.nmae"],
        });
      });
    });
  });

  describe("given a cadence dispatch that rendered cleanly", () => {
    describe("when onDispatched fires with renderDiagnostics absent on the payload", () => {
      it("writes renderDiagnostics as null", async () => {
        const { prisma, updateMany } = makePrismaStub();
        const adapter = new PgOutboxAuditAdapter(prisma);
        const payload = makeCadencePayload();

        await adapter.onDispatched({ payload, at: new Date(), attempt: 1 });

        const arg = updateMany.mock.calls[0]![0];
        // Nullable JSON columns take `Prisma.DbNull` (not a bare `null`) to
        // write SQL NULL on a clean render.
        expect(arg.data.renderDiagnostics).toBe(Prisma.DbNull);
        // A clean render also leaves lastError null (it is not a drop).
        expect(arg.data.lastError).toBeNull();
      });
    });
  });
});
