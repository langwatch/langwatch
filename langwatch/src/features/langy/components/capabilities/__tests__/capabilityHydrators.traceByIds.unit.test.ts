import { describe, expect, it, vi } from "vitest";
import { CAPABILITY_HYDRATORS } from "../capabilityHydrators";

describe("CAPABILITY_HYDRATORS.trace.byIds", () => {
  describe("given a list of trace ids to hydrate for the capability card", () => {
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
      const utils = {
        tracesV2: { header: { fetch: fetchMock } },
      } as unknown as Parameters<
        NonNullable<(typeof CAPABILITY_HYDRATORS)["trace"]["byIds"]>
      >[0]["utils"];

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
    });
  });
});
