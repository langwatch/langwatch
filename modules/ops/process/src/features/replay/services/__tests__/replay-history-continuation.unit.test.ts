import type { ReplayHistoryEntry, ReplayHistoryPage } from "@langwatch/ops-contract";
import { describe, expect, it, vi } from "vitest";

import type { OpsReplayRuntime, OpsReplayRuntimeFactory } from "../../../../app/ops.app.ts";
import { MemoryOpsStore } from "../../../../repositories/memory/memory.ops.store.ts";
import { MemoryReplayRepository } from "../../../../repositories/memory/memory.replay.repository.ts";
import { ReplayService } from "../replay.service.ts";

const entry = ({ runId, startedAt }: { runId: string; startedAt: string }): ReplayHistoryEntry => ({
  runId,
  projectionNames: ["trace-summary"],
  since: "2026-01-01T00:00:00.000Z",
  tenantIds: [],
  description: `run ${runId}`,
  startedAt,
  completedAt: startedAt,
  state: "completed",
  userName: "operator@example.com",
  aggregatesProcessed: 1,
  eventsProcessed: 1,
  error: null,
});

const serviceWithRuns = async ({ count }: { count: number }) => {
  const repo = MemoryReplayRepository.create({ store: MemoryOpsStore.create() });
  const runtimeFactory: OpsReplayRuntimeFactory = { create: vi.fn<() => OpsReplayRuntime>() };
  const service = ReplayService.create({ repo, runtimeFactory });
  for (let index = 1; index <= count; index++) {
    await repo.pushToHistory({
      entry: entry({ runId: `run_${index}`, startedAt: "2026-10-01T00:00:00.000Z" }),
    });
  }

  return { service, repo };
};

const pageOf = (page: ReplayHistoryPage) => {
  if (page.outcome !== "page") throw new Error(`expected a page, got ${page.outcome}`);

  return page;
};

const runIds = (entries: ReplayHistoryEntry[]) => entries.map((item) => item.runId);

describe("the replay history, read by page", () => {
  describe("when the history holds more runs than one page", () => {
    /** @scenario "The replay history continues page by page, newest first, to its end" */
    it("lists every run once, newest first, and only the last page ends", async () => {
      const { service } = await serviceWithRuns({ count: 7 });
      const everyRun = runIds(await service.getHistory());

      const first = pageOf(await service.getHistoryPage({ limit: 3 }));
      const second = pageOf(
        await service.getHistoryPage({ limit: 3, cursor: first.nextCursor ?? "" }),
      );
      const last = pageOf(
        await service.getHistoryPage({ limit: 3, cursor: second.nextCursor ?? "" }),
      );

      expect(everyRun).toEqual(["run_7", "run_6", "run_5", "run_4", "run_3", "run_2", "run_1"]);
      expect([
        ...runIds(first.entries),
        ...runIds(second.entries),
        ...runIds(last.entries),
      ]).toEqual(everyRun);
      expect([first.hasMore, second.hasMore, last.hasMore]).toEqual([true, true, false]);
      expect(last.nextCursor).toBeNull();
    });

    it("ends the first page when the history is exactly one page long", async () => {
      const { service } = await serviceWithRuns({ count: 3 });

      const page = pageOf(await service.getHistoryPage({ limit: 3 }));

      expect(runIds(page.entries)).toEqual(["run_3", "run_2", "run_1"]);
      expect(page).toMatchObject({ hasMore: false, nextCursor: null });
    });

    it("answers an empty page, not an expiry, when no run has ever finished", async () => {
      const { service } = await serviceWithRuns({ count: 0 });

      await expect(service.getHistoryPage({ limit: 20 })).resolves.toEqual({
        outcome: "page",
        entries: [],
        hasMore: false,
        nextCursor: null,
      });
    });

    it("keeps runs that share a timestamp in the order the history lists them", async () => {
      const { service } = await serviceWithRuns({ count: 4 });

      const first = pageOf(await service.getHistoryPage({ limit: 2 }));
      const second = pageOf(
        await service.getHistoryPage({ limit: 2, cursor: first.nextCursor ?? "" }),
      );

      expect([...runIds(first.entries), ...runIds(second.entries)]).toEqual([
        "run_4",
        "run_3",
        "run_2",
        "run_1",
      ]);
    });
  });

  describe("when a run finishes between two pages", () => {
    /** @scenario "A run finishing between two pages does not repeat or skip a run" */
    it("continues after the last run the reader saw", async () => {
      const { service, repo } = await serviceWithRuns({ count: 5 });
      const first = pageOf(await service.getHistoryPage({ limit: 2 }));

      await repo.pushToHistory({
        entry: entry({ runId: "run_6", startedAt: "2026-10-02T00:00:00.000Z" }),
      });
      const second = pageOf(
        await service.getHistoryPage({ limit: 2, cursor: first.nextCursor ?? "" }),
      );

      expect(runIds(first.entries)).toEqual(["run_5", "run_4"]);
      expect(runIds(second.entries)).toEqual(["run_3", "run_2"]);
    });
  });

  describe("when the cursor's run is no longer retained", () => {
    /** @scenario "A cursor whose run has left the retained history asks the reader to restart" */
    it("answers cursor_expired for a run trimmed off the end of the history", async () => {
      const { service, repo } = await serviceWithRuns({ count: 20 });
      const first = pageOf(await service.getHistoryPage({ limit: 20, cursor: void 0 }));
      expect(first.entries.at(-1)?.runId).toBe("run_1");

      await repo.pushToHistory({
        entry: entry({ runId: "run_21", startedAt: "2026-10-02T00:00:00.000Z" }),
      });

      await expect(service.getHistoryPage({ limit: 5, cursor: "run_1" })).resolves.toEqual({
        outcome: "cursor_expired",
      });
    });

    it("answers cursor_expired for a run id the history never held", async () => {
      const { service } = await serviceWithRuns({ count: 3 });

      await expect(service.getHistoryPage({ limit: 5, cursor: "run_elsewhere" })).resolves.toEqual({
        outcome: "cursor_expired",
      });
    });

    it("answers cursor_expired when the history is empty", async () => {
      const { service } = await serviceWithRuns({ count: 0 });

      await expect(service.getHistoryPage({ limit: 5, cursor: "run_1" })).resolves.toEqual({
        outcome: "cursor_expired",
      });
    });
  });

  describe("given the whole-history read the page is added beside", () => {
    it("still returns every retained run, newest first, as one array", async () => {
      const { service, repo } = await serviceWithRuns({ count: 4 });

      await service.getHistoryPage({ limit: 1 });

      expect(await service.getHistory()).toEqual(await repo.findHistory());
      expect(runIds(await service.getHistory())).toEqual(["run_4", "run_3", "run_2", "run_1"]);
    });
  });
});
