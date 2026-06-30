/**
 * Unit tests for the thin storage meter dispatch reactor (ADR-027 Phase 4):
 * it resolves the org from the event's project and delegates to the injected
 * dispatch, swallowing errors so a transient failure never fails the queue job.
 */

import { describe, expect, it, vi } from "vitest";

const { mockResolveOrganizationId, createMockLogger } = vi.hoisted(() => {
  const createMockLogger = () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  });
  return { mockResolveOrganizationId: vi.fn(), createMockLogger };
});

vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId: mockResolveOrganizationId,
}));
vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

import { createStorageMeterDispatchReactor } from "../storageMeterDispatch.reactor";

const event = {} as any;
const context = { tenantId: "proj-1", aggregateId: "a", foldState: {} } as any;

describe("createStorageMeterDispatchReactor", () => {
  it("runs only in worker with per-project dedup", () => {
    const reactor = createStorageMeterDispatchReactor({
      getDispatch: () => vi.fn(),
    });
    expect(reactor.name).toBe("storageMeterDispatch");
    expect(reactor.options!.runIn).toEqual(["worker"]);
    expect(
      reactor.options!.makeJobId!({ event: { tenantId: "proj-1" } } as any),
    ).toBe("storage_dispatch_proj-1");
  });

  describe("when the project resolves to an organization", () => {
    it("delegates to the dispatch with the organization id", async () => {
      mockResolveOrganizationId.mockResolvedValue("org-1");
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const reactor = createStorageMeterDispatchReactor({
        getDispatch: () => dispatch,
      });

      await reactor.handle(event, context);

      expect(dispatch).toHaveBeenCalledWith({ organizationId: "org-1" });
    });
  });

  describe("when the project has no organization", () => {
    it("skips dispatch", async () => {
      mockResolveOrganizationId.mockResolvedValue(null);
      const dispatch = vi.fn();
      const reactor = createStorageMeterDispatchReactor({
        getDispatch: () => dispatch,
      });

      await reactor.handle(event, context);

      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("when dispatch throws", () => {
    it("swallows the error so the queue job does not fail", async () => {
      mockResolveOrganizationId.mockResolvedValue("org-1");
      const reactor = createStorageMeterDispatchReactor({
        getDispatch: () => vi.fn().mockRejectedValue(new Error("boom")),
      });

      await expect(reactor.handle(event, context)).resolves.toBeUndefined();
    });
  });
});
