// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setWindowAddress } from "../../../../../../__tests__/window-location-router.ts";

const mocks = vi.hoisted(() => ({ openDrawer: vi.fn() }));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({
    openDrawer: mocks.openDrawer,
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
    goBackTo: vi.fn(),
    backStack: [],
  }),
}));

const { useTraceDrawerNavigation } = await import("../use-trace-drawer-navigation.ts");

const REPLAY =
  "/acme/traces?drawer.open=traceV2Details&drawer.traceId=turn-1&drawer.projectId=personal-project";

describe("useTraceDrawerNavigation", () => {
  beforeEach(() => {
    mocks.openDrawer.mockClear();
    setWindowAddress({ url: REPLAY });
  });

  describe("given a replay opened on a session in another workspace", () => {
    describe("when the reader moves to another turn of the same session", () => {
      /** @scenario "Moving between turns stays in the session's workspace" */
      it("carries the workspace the replay was opened in", () => {
        const { result } = renderHook(() => useTraceDrawerNavigation());

        result.current.navigateToTrace({
          fromTraceId: "turn-1",
          fromViewMode: "trace",
          toTraceId: "turn-2",
        });

        expect(mocks.openDrawer).toHaveBeenCalledWith(
          "traceV2Details",
          expect.objectContaining({ traceId: "turn-2", projectId: "personal-project" }),
          { replace: false },
        );
      });
    });
  });
});
