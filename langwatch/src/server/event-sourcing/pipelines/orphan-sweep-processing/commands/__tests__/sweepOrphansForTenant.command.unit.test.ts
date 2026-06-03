/**
 * Unit tests for the sweepOrphansForTenant command handler.
 *
 * This command replaces the BullMQ orphan-sweep chain (ADR-023). It runs one
 * bounded sweep increment per tenant on the event-sourcing groupQueue and
 * self-perpetuates via `selfDispatch` (the pipeline applies the 6h delay).
 * Modeled on the billing-reporting `reportUsageForMonth` command.
 *
 * Mocks the boundaries: project lookup, OrphanSweepService.sweepProject,
 * selfDispatch, logger, and error capture.
 *
 * @see specs/data-retention/orphan-sweep.feature
 * @see EPIC/Q2/data-retention/queue/orphan-sweep-on-groupqueue.spec.md (§8)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../../../../";
import { createTenantId } from "../../../../domain/tenantId";
import type { SweepOrphansForTenantCommandData } from "../../schemas/commands";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockLoadProject,
  mockSweepProject,
  mockSelfDispatch,
  mockCaptureException,
  createMockLogger,
} = vi.hoisted(() => {
  const createMockLogger = () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  });
  return {
    mockLoadProject: vi.fn(),
    mockSweepProject: vi.fn(),
    mockSelfDispatch: vi.fn(),
    mockCaptureException: vi.fn(),
    createMockLogger,
  };
});

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: mockCaptureException,
  withScope: vi.fn((cb: (scope: Record<string, unknown>) => void) => {
    cb({ setTag: vi.fn(), setExtra: vi.fn() });
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT = "project-1";

function makeCommand(
  data: Partial<SweepOrphansForTenantCommandData> = {},
): Command<SweepOrphansForTenantCommandData> {
  const payload: SweepOrphansForTenantCommandData = {
    tenantId: TENANT,
    occurredAt: 1_000,
    consecutiveFailures: 0,
    ...data,
  };
  return {
    tenantId: createTenantId(payload.tenantId),
    aggregateId: payload.tenantId,
    type: "lw.orphan_sweep.sweep_tenant" as any,
    data: payload,
  };
}

async function createHandler() {
  const { SweepOrphansForTenantCommand } = await import(
    "../sweepOrphansForTenant.command"
  );
  return new SweepOrphansForTenantCommand({
    loadProject: mockLoadProject,
    sweepProject: mockSweepProject,
    selfDispatch: mockSelfDispatch,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SweepOrphansForTenantCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the project is active", () => {
    beforeEach(() => {
      mockLoadProject.mockResolvedValue({ archivedAt: null });
      mockSweepProject.mockResolvedValue(undefined);
    });

    it("sweeps the tenant's orphans", async () => {
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(mockSweepProject).toHaveBeenCalledWith({ projectId: TENANT });
      expect(result).toEqual([]);
    });

    it("self-dispatches the next increment with the failure counter reset to 0", async () => {
      const handler = await createHandler();

      await handler.handle(makeCommand({ consecutiveFailures: 3 }));

      expect(mockSelfDispatch).toHaveBeenCalledTimes(1);
      expect(mockSelfDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT, consecutiveFailures: 0 }),
      );
    });
  });

  describe("given the project has been archived", () => {
    it("does not sweep and does not self-dispatch (loop ends)", async () => {
      mockLoadProject.mockResolvedValue({ archivedAt: new Date("2026-05-30") });
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(mockSweepProject).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe("given the project has been hard-deleted", () => {
    it("does not sweep and does not self-dispatch (loop ends)", async () => {
      mockLoadProject.mockResolvedValue(null);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockSweepProject).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });
  });

  describe("given the sweep throws a transient error", () => {
    /**
     * A flaky PG/CH error must NOT silence the loop. The handler swallows the
     * error, still self-dispatches the next increment, and increments the
     * consecutive-failure counter carried in the payload.
     */
    it("still self-dispatches with the failure counter incremented", async () => {
      mockLoadProject.mockResolvedValue({ archivedAt: null });
      mockSweepProject.mockRejectedValue(new Error("postgres timeout"));
      const handler = await createHandler();

      const result = await handler.handle(
        makeCommand({ consecutiveFailures: 1 }),
      );

      expect(mockSweepProject).toHaveBeenCalledWith({ projectId: TENANT });
      expect(mockSelfDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT, consecutiveFailures: 2 }),
      );
      expect(result).toEqual([]);
    });
  });

  describe("given the failure counter has reached the circuit-breaker threshold", () => {
    /**
     * After MAX_CONSECUTIVE_SWEEP_FAILURES consecutive failed increments the
     * loop stops self-dispatching and surfaces the condition, rather than
     * retrying a permanently-broken sweep forever. The next ingest re-seeds.
     */
    it("stops: no sweep, no self-dispatch, error captured", async () => {
      mockLoadProject.mockResolvedValue({ archivedAt: null });
      const handler = await createHandler();

      await handler.handle(makeCommand({ consecutiveFailures: 5 }));

      expect(mockSweepProject).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
      expect(mockCaptureException).toHaveBeenCalledTimes(1);
    });
  });
});
