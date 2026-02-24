import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRunHistoryStore } from "../useRunHistoryStore";
import type { RunHistoryState } from "../useRunHistoryStore";

/**
 * Unit tests for the run history store.
 *
 * Tests the zustand store logic for groupBy state, filter state,
 * URL serialization, and URL hydration.
 */

function createStore() {
  return createRunHistoryStore();
}

function getState(store: ReturnType<typeof createStore>): RunHistoryState {
  return store.getState();
}

describe("useRunHistoryStore", () => {
  describe("initial state", () => {
    it("defaults groupBy to 'none'", () => {
      const store = createStore();
      expect(getState(store).groupBy).toBe("none");
    });

    it("defaults filters to empty strings", () => {
      const store = createStore();
      expect(getState(store).filters).toEqual({
        scenarioId: "",
        passFailStatus: "",
      });
    });
  });

  describe("setGroupBy()", () => {
    let store: ReturnType<typeof createStore>;

    beforeEach(() => {
      store = createStore();
    });

    it("updates groupBy to 'scenario'", () => {
      getState(store).setGroupBy("scenario");
      expect(getState(store).groupBy).toBe("scenario");
    });

    it("updates groupBy to 'target'", () => {
      getState(store).setGroupBy("target");
      expect(getState(store).groupBy).toBe("target");
    });

    it("updates groupBy back to 'none'", () => {
      getState(store).setGroupBy("target");
      getState(store).setGroupBy("none");
      expect(getState(store).groupBy).toBe("none");
    });

    it("preserves existing filters when changing groupBy", () => {
      getState(store).setFilter("scenarioId", "login-scenario");
      getState(store).setGroupBy("target");
      expect(getState(store).filters.scenarioId).toBe("login-scenario");
    });
  });

  describe("setFilter()", () => {
    let store: ReturnType<typeof createStore>;

    beforeEach(() => {
      store = createStore();
    });

    it("updates scenarioId filter", () => {
      getState(store).setFilter("scenarioId", "scen_1");
      expect(getState(store).filters.scenarioId).toBe("scen_1");
    });

    it("updates passFailStatus filter", () => {
      getState(store).setFilter("passFailStatus", "pass");
      expect(getState(store).filters.passFailStatus).toBe("pass");
    });

    it("preserves other filters when setting one", () => {
      getState(store).setFilter("scenarioId", "scen_1");
      getState(store).setFilter("passFailStatus", "fail");
      expect(getState(store).filters.scenarioId).toBe("scen_1");
      expect(getState(store).filters.passFailStatus).toBe("fail");
    });

    it("preserves groupBy when setting a filter", () => {
      getState(store).setGroupBy("target");
      getState(store).setFilter("scenarioId", "scen_1");
      expect(getState(store).groupBy).toBe("target");
    });
  });

  describe("syncToUrl()", () => {
    let store: ReturnType<typeof createStore>;
    let mockRouter: Parameters<RunHistoryState["syncToUrl"]>[0];

    beforeEach(() => {
      store = createStore();
      mockRouter = {
        query: { project: "my-project" },
        push: vi.fn() as Parameters<RunHistoryState["syncToUrl"]>[0]["push"],
      };
    });

    it("omits groupBy param when value is 'none'", () => {
      getState(store).syncToUrl(mockRouter);

      expect(mockRouter.push).toHaveBeenCalledWith(
        { query: expect.not.objectContaining({ groupBy: expect.anything() }) },
        undefined,
        { shallow: true },
      );
    });

    it("includes groupBy param when value is 'target'", () => {
      getState(store).setGroupBy("target");
      getState(store).syncToUrl(mockRouter);

      expect(mockRouter.push).toHaveBeenCalledWith(
        { query: expect.objectContaining({ groupBy: "target" }) },
        undefined,
        { shallow: true },
      );
    });

    it("includes groupBy param when value is 'scenario'", () => {
      getState(store).setGroupBy("scenario");
      getState(store).syncToUrl(mockRouter);

      expect(mockRouter.push).toHaveBeenCalledWith(
        { query: expect.objectContaining({ groupBy: "scenario" }) },
        undefined,
        { shallow: true },
      );
    });

    it("preserves existing query params from router", () => {
      getState(store).setGroupBy("target");
      getState(store).syncToUrl(mockRouter);

      expect(mockRouter.push).toHaveBeenCalledWith(
        { query: expect.objectContaining({ project: "my-project", groupBy: "target" }) },
        undefined,
        { shallow: true },
      );
    });

    it("omits empty filter values", () => {
      getState(store).syncToUrl(mockRouter);

      const call = vi.mocked(mockRouter.push).mock.calls[0]!;
      const query = (call[0] as { query: Record<string, string> }).query;
      expect(query).not.toHaveProperty("scenarioId");
      expect(query).not.toHaveProperty("passFailStatus");
    });

    it("includes non-empty filter values", () => {
      getState(store).setFilter("scenarioId", "scen_1");
      getState(store).syncToUrl(mockRouter);

      expect(mockRouter.push).toHaveBeenCalledWith(
        { query: expect.objectContaining({ scenarioId: "scen_1" }) },
        undefined,
        { shallow: true },
      );
    });

    it("uses shallow push to avoid full page reload", () => {
      getState(store).syncToUrl(mockRouter);

      const call = vi.mocked(mockRouter.push).mock.calls[0]!;
      expect(call[2]).toEqual({ shallow: true });
    });
  });

  describe("hydrateFromUrl()", () => {
    let store: ReturnType<typeof createStore>;

    beforeEach(() => {
      store = createStore();
    });

    it("sets groupBy from query param", () => {
      getState(store).hydrateFromUrl({ groupBy: "target" });
      expect(getState(store).groupBy).toBe("target");
    });

    it("defaults groupBy to 'none' when query param is absent", () => {
      getState(store).hydrateFromUrl({});
      expect(getState(store).groupBy).toBe("none");
    });

    it("defaults groupBy to 'none' when query param is invalid", () => {
      getState(store).hydrateFromUrl({ groupBy: "invalid-value" });
      expect(getState(store).groupBy).toBe("none");
    });

    it("sets scenarioId filter from query param", () => {
      getState(store).hydrateFromUrl({ scenarioId: "scen_1" });
      expect(getState(store).filters.scenarioId).toBe("scen_1");
    });

    it("sets passFailStatus filter from query param", () => {
      getState(store).hydrateFromUrl({ passFailStatus: "fail" });
      expect(getState(store).filters.passFailStatus).toBe("fail");
    });

    it("hydrates both groupBy and filters together", () => {
      getState(store).hydrateFromUrl({
        groupBy: "scenario",
        scenarioId: "scen_2",
        passFailStatus: "pass",
      });

      expect(getState(store).groupBy).toBe("scenario");
      expect(getState(store).filters.scenarioId).toBe("scen_2");
      expect(getState(store).filters.passFailStatus).toBe("pass");
    });

    it("ignores array values for groupBy (takes first element)", () => {
      getState(store).hydrateFromUrl({ groupBy: ["target", "scenario"] });
      expect(getState(store).groupBy).toBe("target");
    });

    it("resets filters to empty when query params are absent", () => {
      getState(store).setFilter("scenarioId", "old-value");
      getState(store).hydrateFromUrl({});
      expect(getState(store).filters.scenarioId).toBe("");
    });
  });
});
