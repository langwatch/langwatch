/**
 * @vitest-environment jsdom
 *
 * The canonical /[project]/traces/[trace] short link (used by notification
 * links and API responses) must open the Trace Explorer drawer for that
 * trace, and a malformed link must land on not-found instead of a blank
 * page. Only the router is harnessed — the real redirect component runs.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockQuery: Record<string, string | undefined> = {};
const mockReplace = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: mockQuery, isReady: true, replace: mockReplace }),
}));

import TraceDeepLinkRedirect from "../[trace]";

describe("canonical trace deep-link redirect", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockQuery = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("when opening a trace short link", () => {
    it("redirects to the Trace Explorer drawer for that trace", () => {
      mockQuery = { project: "acme", trace: "trace-1" };

      render(<TraceDeepLinkRedirect />);

      expect(mockReplace).toHaveBeenCalledWith(
        "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1",
      );
    });
  });

  describe("when the link is malformed", () => {
    /** @scenario "A malformed trace link lands on not-found instead of a blank page" */
    it("redirects to not-found when the trace id is missing", () => {
      mockQuery = { project: "acme" };

      render(<TraceDeepLinkRedirect />);

      expect(mockReplace).toHaveBeenCalledWith("/404");
    });

    it("redirects to not-found when the project slug is missing", () => {
      mockQuery = { trace: "trace-1" };

      render(<TraceDeepLinkRedirect />);

      expect(mockReplace).toHaveBeenCalledWith("/404");
    });
  });
});
