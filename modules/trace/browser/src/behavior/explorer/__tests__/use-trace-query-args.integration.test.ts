// @vitest-environment jsdom
/**
 * The drawer queries by trace id alone straight away, and forwards `occurredAtMs`
 * whenever it already knows it. @see specs/traces-v2/trace-drawer-shell.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTraceQueryArgs } from "../use-trace-query-args.ts";

let storeState: { traceId: string | null; occurredAtMs: number | null };

vi.mock("../../use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1" } }),
}));
vi.mock("../context/trace-viewer-context.tsx", () => ({
  useTraceViewer: () => ({ traceId: null }),
}));
vi.mock("../../trace-drawer.ts", () => ({
  useTraceDrawer: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));
vi.mock("../../../features/trace-drawer/behavior/use-drawer-project-id.ts", () => ({
  useDrawerProjectId: () => "p1",
}));

describe("useTraceQueryArgs", () => {
  let nextTrace = 0;
  beforeEach(() => {
    nextTrace += 1;
    storeState = { traceId: `t${nextTrace}`, occurredAtMs: null };
  });

  describe("when the drawer opened from a link with no partition hint", () => {
    /** @scenario "The browser opens a trace by id alone" */
    it("is ready at once and sends no occurredAtMs", () => {
      const { result } = renderHook(() => useTraceQueryArgs());

      expect(result.current.isReady).toBe(true);
      expect(result.current.queryArgs).toEqual({
        projectId: "p1",
        traceId: storeState.traceId,
      });
    });
  });

  describe("when the hint is already known, from the URL or a list row", () => {
    /** @scenario "The browser opens a trace by id alone" */
    it("forwards it as occurredAtMs", () => {
      storeState = { traceId: storeState.traceId, occurredAtMs: 1714476000000 };

      const { result } = renderHook(() => useTraceQueryArgs());

      expect(result.current.queryArgs).toEqual({
        projectId: "p1",
        traceId: storeState.traceId,
        occurredAtMs: 1714476000000,
      });
    });
  });

  describe("when the header back-fills the time after a bare-id link opened", () => {
    /** @scenario "The browser opens a trace by id alone" */
    it("keeps the read args unchanged while isLive follows the back-filled time", () => {
      const { result, rerender } = renderHook(() => useTraceQueryArgs());
      const before = result.current.queryArgs;
      expect(result.current.isLive).toBe(false);

      storeState = { ...storeState, occurredAtMs: Date.now() - 1000 };
      rerender();

      expect(result.current.queryArgs).toEqual(before);
      expect(result.current.queryArgs).not.toHaveProperty("occurredAtMs");
      expect(result.current.isLive).toBe(true);
    });
  });
});
