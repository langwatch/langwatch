// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setWindowAddress } from "../../../../__tests__/window-location-router.ts";

const mocks = vi.hoisted(() => ({ openDrawer: vi.fn() }));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("@langwatch/browser-host/drawer", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDrawer: () => ({
    openDrawer: mocks.openDrawer,
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
    goBackTo: vi.fn(),
    backStack: [],
  }),
}));

const { useTraceDrawerNavigation } = await import("../use-trace-drawer-navigation.ts");

const MEMBER = "project-member";
const OPEN = "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-first&drawer.t=1000";

function walkToNextTurn(input: { toTenantId?: string | null } = {}) {
  const { result } = renderHook(() => useTraceDrawerNavigation());
  result.current.navigateToTrace({
    fromTraceId: "trace-first",
    fromViewMode: "trace",
    toTraceId: "trace-next",
    toTimestamp: 2_000,
    ...input,
  });
}

beforeEach(() => mocks.openDrawer.mockClear());

describe("given a drawer open on a member's trace under an aggregate", () => {
  beforeEach(() => setWindowAddress({ url: `${OPEN}&drawer.tenantId=${MEMBER}` }));

  describe("when the reader walks to the next turn", () => {
    it("opens it on the same member and names the member in the link", () => {
      walkToNextTurn();

      expect(mocks.openDrawer).toHaveBeenLastCalledWith(
        "traceV2Details",
        expect.objectContaining({ traceId: "trace-next", t: "2000", tenantId: MEMBER }),
        { replace: false },
      );
    });
  });

  describe("when the caller names another member", () => {
    it("opens the trace on that member", () => {
      walkToNextTurn({ toTenantId: "project-other" });

      expect(mocks.openDrawer).toHaveBeenLastCalledWith(
        "traceV2Details",
        expect.objectContaining({ tenantId: "project-other" }),
        { replace: false },
      );
    });
  });
});

describe("given a drawer open on a plain project's trace", () => {
  beforeEach(() => setWindowAddress({ url: OPEN }));

  describe("when the reader walks to the next turn", () => {
    it("names no member, so the link is unchanged", () => {
      walkToNextTurn();

      expect(mocks.openDrawer.mock.lastCall?.[1]).not.toHaveProperty("tenantId");
    });
  });
});
