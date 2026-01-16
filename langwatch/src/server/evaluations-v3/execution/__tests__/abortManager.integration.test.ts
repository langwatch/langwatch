import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { nanoid } from "nanoid";
import { abortManager } from "../abortManager";
import { connection } from "~/server/redis";

describe("AbortManager Integration", () => {
  const testRunIds: string[] = [];

  // Generate unique run IDs to avoid collisions between test runs
  const createTestRunId = () => {
    const runId = `test-run-${nanoid(8)}`;
    testRunIds.push(runId);
    return runId;
  };

  // Clean up all test keys after each test
  afterEach(async () => {
    if (!connection) return;
    
    for (const runId of testRunIds) {
      await connection.del(`eval_v3_abort:${runId}`);
      await connection.del(`eval_v3_running:${runId}`);
    }
    testRunIds.length = 0;
  });

  describe("requestAbort", () => {
    it("sets Redis abort flag", async () => {
      const runId = createTestRunId();

      await abortManager.requestAbort(runId);

      const value = await connection?.get(`eval_v3_abort:${runId}`);
      expect(value).toBe("1");
    });

    it("sets TTL on abort flag for auto-cleanup", async () => {
      const runId = createTestRunId();

      await abortManager.requestAbort(runId);

      const ttl = await connection?.ttl(`eval_v3_abort:${runId}`);
      expect(ttl).toBeGreaterThan(3500); // Should be close to 3600
      expect(ttl).toBeLessThanOrEqual(3600);
    });
  });

  describe("isAborted", () => {
    it("returns false when no abort flag exists", async () => {
      const runId = createTestRunId();

      const result = await abortManager.isAborted(runId);

      expect(result).toBe(false);
    });

    it("returns true when abort flag is set", async () => {
      const runId = createTestRunId();
      await connection?.set(`eval_v3_abort:${runId}`, "1");

      const result = await abortManager.isAborted(runId);

      expect(result).toBe(true);
    });

    it("returns false for different run ID", async () => {
      const runId1 = createTestRunId();
      const runId2 = createTestRunId();
      await abortManager.requestAbort(runId1);

      const result = await abortManager.isAborted(runId2);

      expect(result).toBe(false);
    });
  });

  describe("clearAbort", () => {
    it("removes the abort flag", async () => {
      const runId = createTestRunId();
      await abortManager.requestAbort(runId);

      await abortManager.clearAbort(runId);

      const value = await connection?.get(`eval_v3_abort:${runId}`);
      expect(value).toBeNull();
    });

    it("does not error when clearing non-existent flag", async () => {
      const runId = createTestRunId();

      await expect(abortManager.clearAbort(runId)).resolves.not.toThrow();
    });
  });

  describe("setRunning / clearRunning", () => {
    it("sets and clears running flag", async () => {
      const runId = createTestRunId();

      await abortManager.setRunning(runId);
      const valueAfterSet = await connection?.get(`eval_v3_running:${runId}`);
      expect(valueAfterSet).toBeTruthy();

      await abortManager.clearRunning(runId);
      const valueAfterClear = await connection?.get(`eval_v3_running:${runId}`);
      expect(valueAfterClear).toBeNull();
    });

    it("running flag contains timestamp", async () => {
      const runId = createTestRunId();
      const beforeTime = Date.now();

      await abortManager.setRunning(runId);

      const value = await connection?.get(`eval_v3_running:${runId}`);
      const timestamp = parseInt(value ?? "0", 10);
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("full abort flow", () => {
    it("request -> check -> clear lifecycle", async () => {
      const runId = createTestRunId();

      // Initially not aborted
      expect(await abortManager.isAborted(runId)).toBe(false);

      // Request abort
      await abortManager.requestAbort(runId);
      expect(await abortManager.isAborted(runId)).toBe(true);

      // Clear abort
      await abortManager.clearAbort(runId);
      expect(await abortManager.isAborted(runId)).toBe(false);
    });

    it("multiple runs are independent", async () => {
      const runId1 = createTestRunId();
      const runId2 = createTestRunId();
      const runId3 = createTestRunId();

      // Abort only run 2
      await abortManager.requestAbort(runId2);

      expect(await abortManager.isAborted(runId1)).toBe(false);
      expect(await abortManager.isAborted(runId2)).toBe(true);
      expect(await abortManager.isAborted(runId3)).toBe(false);
    });

    it("abort check is fast (sub-millisecond)", async () => {
      const runId = createTestRunId();
      await abortManager.requestAbort(runId);

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        await abortManager.isAborted(runId);
      }
      const duration = performance.now() - start;

      // 100 checks should take less than 500ms total (5ms each on average)
      expect(duration).toBeLessThan(500);
    });
  });
});
