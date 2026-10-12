/**
 * @vitest-environment jsdom
 * @see modules/experiment/specs/experiment-list-page.feature
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { id: string; settled: boolean; resolve: () => void; reject: () => void };
const server = vi.hoisted(() => ({ calls: [] as unknown[] }));
const calls = () => server.calls as Call[];

vi.mock("../../experiment-api.ts", async () => {
  const react = await import("@tanstack/react-query");
  const keyOf = (experimentId: string) => ["runs", experimentId];
  return {
    experimentApi: {
      useUtils: () => {
        const client = react.useQueryClient();
        return {
          experiments: {
            getExperimentBatchEvaluationRuns: {
              invalidate: ({ experimentId }: { experimentId: string }) =>
                client.invalidateQueries({ queryKey: keyOf(experimentId) }),
            },
          },
        };
      },
      experiments: {
        getExperimentBatchEvaluationRuns: {
          useQuery: (
            { experimentId }: { experimentId: string },
            options: Record<string, unknown>,
          ) =>
            react.useQuery({
              ...options,
              queryKey: keyOf(experimentId),
              queryFn: () =>
                new Promise((resolve, reject) => {
                  const call: Call = {
                    id: experimentId,
                    settled: false,
                    resolve: () => {
                      call.settled = true;
                      resolve({ runs: [] });
                    },
                    reject: () => {
                      call.settled = true;
                      reject(new Error("boom"));
                    },
                  };
                  server.calls.push(call);
                }),
            }),
        },
      },
    },
  };
});

import { createRunSlotQueue } from "../run-slot-queue.ts";
import { useExperimentListRuns } from "../use-experiment-list-runs.ts";

const inFlight = () => calls().filter((call) => !call.settled);
const ids = (list: Call[]) => list.map((call) => call.id).toSorted();

/** One list row's hook, the way the row component calls it. */
function Row({
  id,
  slots,
  onRequeue,
}: {
  id: string;
  slots: ReturnType<typeof createRunSlotQueue>;
  onRequeue?: (requeue: () => void) => void;
}) {
  const runs = useExperimentListRuns({
    projectId: "p",
    experimentId: id,
    enabled: true,
    urgent: false,
    slots,
  });
  onRequeue?.(runs.requeue);
  return null;
}

function setup({ ids: rowIds, cached = false }: { ids: string[]; cached?: boolean }) {
  const client = new QueryClient();
  const slots = createRunSlotQueue(4);
  if (cached) {
    // answers from six minutes ago: past the five minutes the hook keeps them fresh
    for (const id of rowIds) {
      client.setQueryData(["runs", id], { runs: [] }, { updatedAt: Date.now() - 6 * 60_000 });
    }
  }
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, slots, wrap };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const flush = () => act(async () => void (await tick()));
/** Runs `change`, then lets the hooks and the query client catch up. */
const afterwards = (change: () => void) =>
  act(async () => {
    change();
    await tick();
  });

beforeEach(() => {
  server.calls = [];
});
afterEach(cleanup);

describe("given a list whose rows call useExperimentListRuns", () => {
  describe("when the rows come back with answers cached past the cache time", () => {
    /** @scenario A remounted row with an old cached answer keeps its slot while it refetches */
    it("has at most four calls in flight, and the rest follow as each ends", async () => {
      const rowIds = Array.from({ length: 10 }, (_, index) => `e${index + 1}`);
      const { slots, wrap } = setup({ ids: rowIds, cached: true });
      render(wrap(rowIds.map((id) => <Row key={id} id={id} slots={slots} />)));
      await flush();
      expect(ids(inFlight())).toEqual(["e1", "e2", "e3", "e4"]);
      let answered = 0;
      while (inFlight().length > 0) {
        expect(inFlight().length).toBeLessThanOrEqual(4);
        const [first] = inFlight();
        await afterwards(() => first!.resolve());
        answered += 1;
      }
      expect(answered).toBe(10);
      expect(new Set(calls().map((call) => call.id)).size).toBe(10);
    });
  });

  describe("when a call fails", () => {
    /** @scenario A row gives its slot back when its call fails or the row goes away */
    it("gives the slot to the next row", async () => {
      const rowIds = ["e1", "e2", "e3", "e4", "e5"];
      const { slots, wrap } = setup({ ids: rowIds });
      render(wrap(rowIds.map((id) => <Row key={id} id={id} slots={slots} />)));
      await flush();
      expect(ids(inFlight())).toEqual(["e1", "e2", "e3", "e4"]);
      await afterwards(() =>
        calls()
          .find((call) => call.id === "e1")!
          .reject(),
      );
      expect(ids(inFlight())).toEqual(["e2", "e3", "e4", "e5"]);
    });
  });

  describe("when a row goes away while its call is in flight", () => {
    /** @scenario A row gives its slot back when its call fails or the row goes away */
    it("gives the slot to the next row", async () => {
      const rowIds = ["e1", "e2", "e3", "e4", "e5"];
      const { slots, wrap } = setup({ ids: rowIds });
      function List() {
        const [shown, setShown] = useState(rowIds);
        return (
          <>
            <button onClick={() => setShown(shown.filter((id) => id !== "e1"))}>drop</button>
            {shown.map((id) => (
              <Row key={id} id={id} slots={slots} />
            ))}
          </>
        );
      }
      const view = render(wrap(<List />));
      await flush();
      expect(ids(inFlight())).toEqual(["e1", "e2", "e3", "e4"]);
      await afterwards(() => view.getByText("drop").click());
      expect(ids(inFlight().filter((call) => call.id !== "e1"))).toEqual(["e2", "e3", "e4", "e5"]);
    });
  });

  describe("when cached runs have fallen behind the list", () => {
    /** @scenario A closed row whose runs fell behind goes back through the slots */
    it("fetches again through the slots, four at a time", async () => {
      const rowIds = ["e1", "e2", "e3", "e4", "e5"];
      const { slots, wrap } = setup({ ids: rowIds });
      const requeues = new Map<string, () => void>();
      render(
        wrap(
          rowIds.map((id) => (
            <Row key={id} id={id} slots={slots} onRequeue={(fn) => requeues.set(id, fn)} />
          )),
        ),
      );
      await flush();
      while (inFlight().length > 0) await afterwards(() => inFlight()[0]!.resolve());
      calls().length = 0;
      await afterwards(() => {
        for (const requeue of requeues.values()) requeue();
      });
      expect(ids(inFlight())).toEqual(["e1", "e2", "e3", "e4"]);
      await afterwards(() => inFlight()[0]!.resolve());
      expect(inFlight()).toHaveLength(4);
      expect(new Set(calls().map((call) => call.id)).size).toBe(5);
    });
  });
});
