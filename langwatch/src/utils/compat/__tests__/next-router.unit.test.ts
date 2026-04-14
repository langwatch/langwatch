/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

// The global test-setup mocks ~/utils/compat/next-router. We need the real module.
vi.unmock("~/utils/compat/next-router");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { resolvePathname, buildUrl } = await vi.importActual<
  typeof import("../next-router")
>("~/utils/compat/next-router");

describe("resolvePathname()", () => {
  describe("when path matches a project route", () => {
    it("converts /my-project/messages to /[project]/messages", () => {
      expect(resolvePathname("/my-project/messages")).toBe("/[project]/messages");
    });

    it("converts /my-project/analytics to /[project]/analytics", () => {
      expect(resolvePathname("/my-project/analytics")).toBe(
        "/[project]/analytics"
      );
    });

    it("converts /my-project/evaluations to /[project]/evaluations", () => {
      expect(resolvePathname("/my-project/evaluations")).toBe(
        "/[project]/evaluations"
      );
    });
  });

  describe("when path matches a nested project route", () => {
    it("converts /my-project/analytics/custom/123 to /[project]/analytics/custom/[id]", () => {
      expect(resolvePathname("/my-project/analytics/custom/123")).toBe(
        "/[project]/analytics/custom/[id]"
      );
    });

    it("converts /my-project/messages/trace-abc/traceDetails to /[project]/messages/[trace]/[openTab]", () => {
      expect(
        resolvePathname("/my-project/messages/trace-abc/traceDetails")
      ).toBe("/[project]/messages/[trace]/[openTab]");
    });
  });

  describe("when path matches a static route", () => {
    it("returns /auth/signin as-is", () => {
      expect(resolvePathname("/auth/signin")).toBe("/auth/signin");
    });

    it("returns /settings as-is", () => {
      expect(resolvePathname("/settings")).toBe("/settings");
    });
  });

  describe("when path matches a catch-all route", () => {
    it("converts /settings/models/foo to /settings/[[...path]]", () => {
      expect(resolvePathname("/settings/models/foo")).toBe(
        "/settings/[[...path]]"
      );
    });
  });

  describe("when path has no match", () => {
    it("returns the path unchanged", () => {
      expect(resolvePathname("/unknown/deeply/nested")).toBe(
        "/unknown/deeply/nested"
      );
    });
  });
});

describe("buildUrl()", () => {
  describe("when url is a string", () => {
    it("returns it as-is", () => {
      expect(buildUrl("/foo/bar?x=1")).toBe("/foo/bar?x=1");
    });
  });

  describe("when url is an object with pathname and query", () => {
    it("builds URL from pathname and query params", () => {
      const result = buildUrl({
        pathname: "/my-project/messages",
        query: { view: "table" },
      });
      expect(result).toBe("/my-project/messages?view=table");
    });
  });

  describe("when query contains route params", () => {
    it("strips route params from query string", () => {
      const result = buildUrl(
        {
          pathname: "/my-project/messages",
          query: { project: "my-project", view: "table" },
        },
        new Set(["project"])
      );
      expect(result).toBe("/my-project/messages?view=table");
    });
  });

  describe("when pathname contains [param] patterns", () => {
    it("resolves [project] from query values", () => {
      const result = buildUrl({
        pathname: "/[project]/messages",
        query: { project: "inbox-narrator", view: "table" },
      });
      expect(result).toBe("/inbox-narrator/messages?view=table");
    });

    it("resolves multiple [param] patterns", () => {
      const result = buildUrl({
        pathname: "/[project]/messages/[trace]/[openTab]",
        query: {
          project: "inbox-narrator",
          trace: "abc-123",
          openTab: "traceDetails",
        },
      });
      expect(result).toBe(
        "/inbox-narrator/messages/abc-123/traceDetails"
      );
    });

    it("resolves [[...path]] catch-all from array query value", () => {
      const result = buildUrl({
        pathname: "/settings/[[...path]]",
        query: { path: ["models", "openai"] },
      });
      expect(result).toBe("/settings/models/openai");
    });
  });

  describe("when query has undefined/null values", () => {
    it("omits undefined values from query string", () => {
      const result = buildUrl({
        pathname: "/foo",
        query: { a: "1", b: undefined, c: null, d: "2" },
      });
      expect(result).toBe("/foo?a=1&d=2");
    });
  });

  describe("when query has array values", () => {
    it("appends multiple values for the same key", () => {
      const result = buildUrl({
        pathname: "/foo",
        query: { tags: ["a", "b", "c"] },
      });
      expect(result).toBe("/foo?tags=a&tags=b&tags=c");
    });
  });

  describe("when url is a query-only string with route params", () => {
    it("strips route param keys from query string", () => {
      const result = buildUrl(
        "?project=inbox-narrator&view=table&drawer.open=traceDetails",
        new Set(["project"])
      );
      expect(result).toBe("?view=table&drawer.open=traceDetails");
    });

    it("strips multiple route param keys", () => {
      const result = buildUrl(
        "?project=inbox-narrator&trace=abc&view=table",
        new Set(["project", "trace"])
      );
      expect(result).toBe("?view=table");
    });
  });

  describe("when no query is provided", () => {
    it("returns just the pathname", () => {
      const result = buildUrl({ pathname: "/foo" });
      expect(result).toBe("/foo");
    });
  });
});
