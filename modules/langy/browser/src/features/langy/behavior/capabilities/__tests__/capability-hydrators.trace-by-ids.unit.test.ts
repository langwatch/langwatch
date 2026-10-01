import { describe, expect, it, vi } from "vitest";

import { CAPABILITY_HYDRATORS, type CapabilityTrpcUtils } from "../capability-hydrators.ts";

describe("CAPABILITY_HYDRATORS.trace.byIds", () => {
  describe("given a list of trace ids to hydrate for the capability card", () => {
    describe("when hydrating trace IDs", () => {
      it("fetches each header without the extra spans read full IO resolution costs", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          input: "hello world",
          traceName: "",
          timestamp: 1_700_000_000_000,
          durationMs: 10,
          status: "ok",
          totalCost: null,
          output: null,
        });
        const unused = vi.fn();
        const utils: CapabilityTrpcUtils = {
          traces: { header: { fetch: fetchMock }, list: { fetch: unused } },
          dataset: { getAll: { fetch: unused } },
          prompts: { getAllPromptsForProject: { fetch: unused } },
          experiments: { getAllByProjectId: { fetch: unused } },
        };

        await CAPABILITY_HYDRATORS.trace!.byIds!({
          utils,
          projectId: "p1",
          ids: ["trace-1", "trace-2"],
        });

        expect(fetchMock).toHaveBeenCalledWith({
          projectId: "p1",
          traceId: "trace-1",
          full: false,
        });
        expect(fetchMock).toHaveBeenCalledWith({
          projectId: "p1",
          traceId: "trace-2",
          full: false,
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
    });
  });
});
