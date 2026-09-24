// @vitest-environment jsdom
/**
 * A deep link without `t` opens with one header read, which backfills the
 * hint; every sibling read waits for it. @see specs/traces-v2/trace-drawer-shell.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTraceQueryArgs } from "../use-trace-query-args.ts";

let storeState: { traceId: string | null; occurredAtMs: number | null };

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1" } }),
}));
vi.mock("../../../../elements/explorer/context/trace-viewer-context.tsx", () => ({
  useTraceViewer: () => ({ traceId: null }),
}));
vi.mock("../../../../../behavior/drawer.store.ts", () => ({
  useDrawerStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));
vi.mock("../use-drawer-project-id.ts", () => ({
  useDrawerProjectId: () => "p1",
}));

describe("useTraceQueryArgs", () => {
  beforeEach(() => {
    storeState = { traceId: "t1", occurredAtMs: null };
  });

  describe("when the drawer opened from a deep link with no partition hint", () => {
    /** @scenario "Sibling reads wait for the partition hint on a deep link" */
    it("is ready but reports the hint as missing and sends no occurredAtMs", () => {
      const { result } = renderHook(() => useTraceQueryArgs());

      expect(result.current.isReady).toBe(true);
      expect(result.current.hintReady).toBe(false);
      expect(result.current.queryArgs).toEqual({
        projectId: "p1",
        traceId: "t1",
      });
    });
  });

  describe("when the hint is present, from the opener or backfilled by the header", () => {
    it("reports the hint as ready and forwards it", () => {
      storeState = { traceId: "t1", occurredAtMs: 1714476000000 };

      const { result } = renderHook(() => useTraceQueryArgs());

      expect(result.current.hintReady).toBe(true);
      expect(result.current.queryArgs).toEqual({
        projectId: "p1",
        traceId: "t1",
        occurredAtMs: 1714476000000,
      });
    });
  });
});
