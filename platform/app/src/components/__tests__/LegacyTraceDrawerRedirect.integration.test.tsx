/**
 * @vitest-environment jsdom
 *
 * The legacy trace drawer is gone; `drawer.open=traceDetails` in an address
 * has to keep resolving, because links shared before the removal name it and
 * the drawer shell is resolved straight from the URL.
 *
 * Exercises the real `useDrawer` and the real `qs` serialization — only the
 * router is harnessed, so what is asserted is the navigation the redirect
 * actually performs.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { push, replace, router } = vi.hoisted(() => {
  const push = vi.fn();
  const replace = vi.fn();
  return {
    push,
    replace,
    router: {
      query: {} as Record<string, string>,
      pathname: "/[project]/annotations",
      asPath: "/test-project/annotations?drawer.open=traceDetails",
      push,
      replace,
    },
  };
});

vi.mock("~/utils/compat/next-router", () => ({
  default: router,
  useRouter: () => router,
}));

import { clearDrawerStack, getDrawerStack } from "~/hooks/useDrawer";
import { LegacyTraceDrawerRedirect } from "../LegacyTraceDrawerRedirect";

function lastReplacedUrl(): string {
  expect(replace).toHaveBeenCalled();
  return String(replace.mock.calls[replace.mock.calls.length - 1]?.[0]);
}

describe("LegacyTraceDrawerRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDrawerStack();
    router.pathname = "/[project]/annotations";
    router.asPath = "/test-project/annotations?drawer.open=traceDetails";
    router.query = { "drawer.open": "traceDetails" };
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a link that names the legacy trace drawer", () => {
    /** @scenario "A link naming the legacy trace drawer opens the Trace Explorer drawer" */
    it("swaps the address for the Trace Explorer drawer on the same trace", () => {
      render(<LegacyTraceDrawerRedirect traceId="trace-abc" />);

      const url = lastReplacedUrl();
      expect(url).toMatch(/drawer\.open=traceV2Details/);
      expect(url).toContain("trace-abc");
      expect(url).not.toMatch(/drawer\.open=traceDetails(?![a-zA-Z])/);
    });

    /** @scenario "The redirect leaves the reader on the page the link was opened on" */
    it("keeps the reader on the page rather than moving them to the traces list", () => {
      render(<LegacyTraceDrawerRedirect traceId="trace-abc" />);

      const url = lastReplacedUrl();
      expect(url.startsWith("/test-project/annotations")).toBe(true);
      expect(url).not.toContain("/traces");
    });

    // A pushed redirect would put the legacy address in history, so going back
    // would land on it and be sent forward again — the reader could never
    // leave. Replacing, and resetting the stack the redirect would otherwise
    // seed with the address it is leaving, is what avoids that.
    /** @scenario "Going back from a redirected legacy link does not return to it" */
    it("replaces the address and leaves no legacy entry to go back to", () => {
      render(<LegacyTraceDrawerRedirect traceId="trace-abc" />);

      expect(replace).toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(getDrawerStack().map((entry) => entry.drawer)).toEqual([
        "traceV2Details",
      ]);
    });

    it("forwards the partition-pruning timestamp hint when the link carries one", () => {
      render(
        <LegacyTraceDrawerRedirect traceId="trace-abc" t="1733600000000" />,
      );

      expect(lastReplacedUrl()).toContain("1733600000000");
    });

    it("drops the legacy tab parameters, which the Trace Explorer has no equivalent of", () => {
      render(<LegacyTraceDrawerRedirect traceId="trace-abc" />);

      const url = lastReplacedUrl();
      expect(url).not.toContain("selectedTab");
      expect(url).not.toContain("showMessages");
    });
  });

  describe("given a link that names the legacy trace drawer and a span", () => {
    /** @scenario "A legacy drawer link naming a span keeps the span selected" */
    it("carries the span through to the Trace Explorer drawer", () => {
      render(<LegacyTraceDrawerRedirect traceId="trace-abc" span="span-xyz" />);

      const url = lastReplacedUrl();
      expect(url).toMatch(/drawer\.open=traceV2Details/);
      expect(url).toContain("span-xyz");
    });
  });

  describe("given a link that names the drawer with no trace id", () => {
    /** @scenario "A trace request without a trace id opens no drawer" */
    it("dismisses the drawer instead of leaving an empty shell", () => {
      render(<LegacyTraceDrawerRedirect />);

      expect(replace).not.toHaveBeenCalled();
      expect(push).toHaveBeenCalled();
      const url = String(push.mock.calls[0]?.[0]);
      expect(url).not.toContain("drawer.open");
    });
  });
});
