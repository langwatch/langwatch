/**
 * That a procedure dispatched by name lands in the cache everything else reads.
 *
 * These assertions were `platform/app`'s, on the Agents host adapter that owned
 * this dispatcher before the family moved. They are about the seam rather than
 * the family, so they move with the seam: `BrowserUiRpc` is now the one place in
 * `apps/ui` that turns a procedure path into a React Query entry, and any screen
 * too wide for a typed procedure map goes through it.
 *
 * They assert the SHARING rather than the shape of the key. A key whose encoding
 * is right but which nothing else reaches is the bug, not the fix: the original
 * defect keyed reads under `["agent-ui", path, input]`, which shares no prefix
 * with any tRPC key, so an invalidation on either side was invisible to the
 * other and the symptom was stale UI that looked random.
 */

import { trpcQueryFilter, trpcQueryKey } from "@langwatch/platform-api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { BrowserUiRpc } from "../src/behavior/ui-rpc";
import type { UiFeatureApiTransport } from "../src/behavior/ui-feature-transport";

function transportAnswering(answer: unknown): {
  transport: UiFeatureApiTransport;
  query: ReturnType<typeof vi.fn>;
  mutation: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => answer);
  const mutation = vi.fn(async () => answer);
  return { transport: { query, mutation } as unknown as UiFeatureApiTransport, query, mutation };
}

function keyFor(path: string, input: unknown): readonly unknown[] {
  return trpcQueryKey(path, { input, type: "query" }) as unknown as readonly unknown[];
}

describe("given a procedure dispatched by name", () => {
  describe("when it has been read", () => {
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
      const { transport, query, mutation } = transportAnswering({ ok: true });
      const rpc = BrowserUiRpc.create({ transport, queryClient });

      await rpc.mutate("agents.delete", { id: "agent_1", projectId: "project_1" });

      expect(mutation).toHaveBeenCalledWith("agents.delete", {
        id: "agent_1",
        projectId: "project_1",
      });
      expect(query).not.toHaveBeenCalled();
    });
  });
});
