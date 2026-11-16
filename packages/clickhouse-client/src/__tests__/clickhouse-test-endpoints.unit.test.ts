/**
 * Spec: specs/ops/group-queue-dispatcher-resilience.feature
 */
import { describe, expect, it, vi } from "vitest";

import { migrateTestClickHouseOnce, reusesTestContainers } from "../clickhouse-test-endpoints.ts";

describe("migrateTestClickHouseOnce", () => {
  describe("given the same ClickHouse URL is asked to migrate twice", () => {
    describe("when the second call is made", () => {
      /** @scenario ClickHouse migration guard prevents duplicate migrations per URL */
      it("does not migrate a second time for that URL", async () => {
        const url = `http://localhost:8123/test_guard_${crypto.randomUUID().slice(0, 8)}`;
        const migrate = vi.fn(() => Promise.resolve());

        await migrateTestClickHouseOnce({ url, migrate });
        await migrateTestClickHouseOnce({ url, migrate });

        expect(migrate).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a different ClickHouse URL", () => {
    describe("when it is asked to migrate", () => {
      it("migrates that URL on its own", async () => {
        const first = `http://localhost:8123/test_guard_${crypto.randomUUID().slice(0, 8)}`;
        const second = `http://localhost:8123/test_guard_${crypto.randomUUID().slice(0, 8)}`;
        const migrate = vi.fn(() => Promise.resolve());

        await migrateTestClickHouseOnce({ url: first, migrate });
        await migrateTestClickHouseOnce({ url: second, migrate });

        expect(migrate).toHaveBeenCalledTimes(2);
      });
    });
  });
});

describe("reusesTestContainers", () => {
  describe("given a CI run", () => {
    /** @scenario "On CI a test database stops when its test file ends" */
    it("does not reuse, so the reaper stops each container when its file ends", () => {
      expect(reusesTestContainers({ CI: "true" })).toBe(false);
    });
  });

  describe("given a developer machine", () => {
    it("reuses containers, so the next local run starts fast", () => {
      expect(reusesTestContainers({})).toBe(true);
    });
  });
});
