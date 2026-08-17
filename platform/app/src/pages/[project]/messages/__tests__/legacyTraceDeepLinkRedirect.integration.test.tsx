/**
 * @vitest-environment jsdom
 *
 * Old links under the legacy `/[project]/messages` paths must land on the
 * Trace Explorer. The index redirect carries the link's filters across; the
 * trace deep link opens the Trace Explorer drawer for that trace; the span
 * deep link additionally carries the selected span. Only the router is
 * harnessed — the real redirect components run.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockQuery: Record<string, string | undefined> = {};
const mockReplace = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: mockQuery, isReady: true, replace: mockReplace }),
}));

import TraceDetailsWithSpanRedirect from "../[trace]/[openTab]/[span]";
import TraceDetailsRedirect from "../[trace]/index";
import LegacyTracesRedirect from "../index";

describe("legacy Traces index redirect", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockQuery = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("when opening a bare legacy Traces link", () => {
    /** @scenario "The legacy Traces path lands on the Trace Explorer" */
    it("redirects to the Trace Explorer", () => {
      mockQuery = { project: "acme" };

      render(<LegacyTracesRedirect />);

      expect(mockReplace).toHaveBeenCalledWith({
        pathname: "/acme/traces",
        query: {},
      });
    });
  });

  describe("when the legacy Traces link carries filters", () => {
    /** @scenario "A filtered legacy Traces link keeps what it was filtered by" */
    it("carries everything but the project slug across", () => {
      mockQuery = {
        project: "acme",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        "metadata.env": "prod",
      };

      render(<LegacyTracesRedirect />);

      expect(mockReplace).toHaveBeenCalledWith({
        pathname: "/acme/traces",
        query: {
          startDate: "2026-08-01",
          endDate: "2026-08-07",
          "metadata.env": "prod",
        },
      });
    });
  });

  describe("when the link is malformed", () => {
    it("redirects to not-found when the project slug is missing", () => {
      mockQuery = {};

      render(<LegacyTracesRedirect />);

      expect(mockReplace).toHaveBeenCalledWith("/404");
    });
  });
});

describe("legacy trace deep-link redirects", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockQuery = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("when opening a legacy trace deep link", () => {
    /** @scenario "A legacy trace deep link opens the Trace Explorer" */
    it("redirects to the Trace Explorer drawer for that trace", () => {
      mockQuery = { project: "acme", trace: "trace-1" };

      render(<TraceDetailsRedirect />);

      expect(mockReplace).toHaveBeenCalledWith(
        "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1",
      );
    });
  });

  describe("when opening a legacy span deep link", () => {
    /** @scenario "A legacy span deep link opens the Trace Explorer with the span selected" */
    it("redirects to the Trace Explorer drawer with the span selected", () => {
      mockQuery = { project: "acme", trace: "trace-1", span: "span-9" };

      render(<TraceDetailsWithSpanRedirect />);

      expect(mockReplace).toHaveBeenCalledWith(
        "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-1&drawer.span=span-9",
      );
    });
  });

  describe("when the link is malformed", () => {
    /** @scenario "A malformed trace link lands on not-found instead of a blank page" */
    it("redirects to not-found when the trace id is missing", () => {
      mockQuery = { project: "acme" };

      render(<TraceDetailsRedirect />);

      expect(mockReplace).toHaveBeenCalledWith("/404");
    });

    it("redirects to not-found when the project slug is missing", () => {
      mockQuery = { trace: "trace-1" };

      render(<TraceDetailsRedirect />);

      expect(mockReplace).toHaveBeenCalledWith("/404");
    });

    it("redirects the span deep link to not-found when the trace id is missing", () => {
      mockQuery = { project: "acme", span: "span-9" };

      render(<TraceDetailsWithSpanRedirect />);

      expect(mockReplace).toHaveBeenCalledWith("/404");
    });
  });
});
