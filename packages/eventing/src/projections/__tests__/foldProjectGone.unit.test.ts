import { ProjectNotFoundError } from "@langwatch/authorization";
import type * as observabilityModule from "@langwatch/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

// Capture the router's own logger so the no-op can be asserted to warn.
const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof observabilityModule>();
  return {
    ...actual,
    createLogger: () => ({ warn: warnSpy, error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  };
});

import type { Event } from "../../domain/types.ts";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockQueueManager,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers.ts";
import { ProjectionRouter } from "../projectionRouter.ts";

/** A fold whose project was deleted after its event completes instead of retrying forever. */
describe("a fold whose project no longer exists", () => {
  const tenantId = createTestTenantId();
  const event = createTestEvent(
    TEST_CONSTANTS.AGGREGATE_ID,
    TEST_CONSTANTS.AGGREGATE_TYPE,
    tenantId,
  );

  afterEach(() => {
    vi.clearAllMocks();
  });

  function foldQueues({ readFails }: { readFails: Error }) {
    const queueManager = createMockQueueManager();
    const router = new ProjectionRouter<Event>({
      aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
      pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      queueManager,
    });
    const store = createMockFoldProjectionStore<{ count: number }>();
    vi.mocked(store.get).mockRejectedValue(readFails);
    router.registerFoldProjection(
      createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }) => ({ count: state.count + 1 }),
      }),
    );
    router.initializeFoldQueues();
    const [request] = vi.mocked(queueManager.initializeProjectionQueues).mock.calls[0] ?? [];
    if (!request?.onEventBatch) throw new Error("the router registered no fold queue");
    return { request, store };
  }

  describe("when the fold's read is refused as project not found", () => {
    /** @scenario "A fold whose project no longer exists completes as a no-op" */
    it("completes the single event as a no-op", async () => {
      const { request } = foldQueues({ readFails: new ProjectNotFoundError(tenantId) });

      await expect(request.onEvent("counter", event, { tenantId })).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        { tenantId, projectionName: "counter" },
        expect.stringContaining("no longer exists"),
      );
    });

    it("completes the coalesced batch as a no-op", async () => {
      const { request } = foldQueues({ readFails: new ProjectNotFoundError(tenantId) });

      await expect(
        request.onEventBatch!("counter", [event], { tenantId }),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        { tenantId, projectionName: "counter" },
        expect.stringContaining("no longer exists"),
      );
    });
  });

  describe("when the fold's read fails for any other reason", () => {
    /** @scenario "A fold that fails for any other reason is still retried" */
    it("rethrows so the queue retries the job", async () => {
      const { request } = foldQueues({ readFails: new Error("clickhouse down") });

      await expect(request.onEvent("counter", event, { tenantId })).rejects.toThrow(
        "clickhouse down",
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
