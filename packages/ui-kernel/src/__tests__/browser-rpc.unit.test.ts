/**
 * That a procedure dispatched by name lands in the cache everything else reads.
 */

import {
  trpcQueryFilter,
  trpcQueryKey,
  type ModuleApiMap,
  type RouterFromMap,
} from "@langwatch/api/web";
import { QueryClient } from "@tanstack/react-query";
import { createTRPCUntypedClient } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { describe, expect, it } from "vitest";

import { BrowserUiRpc } from "../browser-rpc.ts";
import type { UiFeatureApiTransport } from "../transport.ts";

type SentOperation = { type: string; path: string; input: unknown };

/** A real untyped client whose only link answers `answer` and records what was sent. */
function transportAnswering(answer: unknown): {
  transport: UiFeatureApiTransport;
  sent: SentOperation[];
} {
  const sent: SentOperation[] = [];
  const transport: UiFeatureApiTransport = createTRPCUntypedClient<RouterFromMap<ModuleApiMap>>({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            sent.push({ type: op.type, path: op.path, input: op.input });
            observer.next({ result: { type: "data", data: answer } });
            observer.complete();
          }),
    ],
  });
  return { transport, sent };
}

function keyFor(path: string, input: unknown): readonly unknown[] {
  return trpcQueryKey(path, { input, type: "query" });
}

describe("given a procedure dispatched by name", () => {
  describe("when it has been read", () => {
    /** @scenario "A dispatched procedure lands under the typed hook's key" */
    it("is invalidated by a tRPC invalidation naming that procedure", async () => {
      const queryClient = new QueryClient();
      const { transport } = transportAnswering({ rows: [] });
      const rpc = BrowserUiRpc.create({ transport, queryClient });

      await rpc.query("tracesV2.list", { projectId: "project_1" });

      // What `utils.tracesV2.list.invalidate()` does, from anywhere else in the
      // application.
      await queryClient.invalidateQueries(trpcQueryFilter("tracesV2.list"));

      expect(
        queryClient.getQueryState(keyFor("tracesV2.list", { projectId: "project_1" }))
          ?.isInvalidated,
      ).toBe(true);
    });

    it("seeds the entry an application hook would read", async () => {
      const queryClient = new QueryClient();
      const { transport } = transportAnswering({ id: "agent_1" });
      const rpc = BrowserUiRpc.create({ transport, queryClient });

      await rpc.query("agents.getById", { id: "agent_1" });

      // What `utils.agents.getById.getData({ id: "agent_1" })` reads.
      expect(queryClient.getQueryData(keyFor("agents.getById", { id: "agent_1" }))).toEqual({
        id: "agent_1",
      });
    });
  });

  describe("when it mutates", () => {
    it("invalidates what the application cached, not only its own reads", async () => {
      const queryClient = new QueryClient();
      const { transport } = transportAnswering({ ok: true });
      const rpc = BrowserUiRpc.create({ transport, queryClient });

      // Seeded the way an application hook would, never through this dispatcher.
      const applicationKey = keyFor("tracesV2.list", { projectId: "project_1" });
      queryClient.setQueryData(applicationKey, { rows: [] });

      await rpc.mutate("tracesV2.delete", { id: "trace_1" });

      expect(queryClient.getQueryState(applicationKey)?.isInvalidated).toBe(true);
    });

    it("sends the mutation on the transport rather than the query lane", async () => {
      const queryClient = new QueryClient();
      const { transport, sent } = transportAnswering({ ok: true });
      const rpc = BrowserUiRpc.create({ transport, queryClient });

      await rpc.mutate("agents.delete", { id: "agent_1", projectId: "project_1" });

      expect(sent).toEqual([
        {
          type: "mutation",
          path: "agents.delete",
          input: { id: "agent_1", projectId: "project_1" },
        },
      ]);
    });
  });
});
