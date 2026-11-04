import { describe, expect, it } from "vitest";

import { type AnalyticsHostProject, projectAwaitsFirstTrace } from "../analytics-host.ts";

const project = (overrides: Partial<AnalyticsHostProject>): AnalyticsHostProject => ({
  id: "p1",
  slug: "p",
  name: "P",
  hasFirstMessage: false,
  ...overrides,
});

describe("projectAwaitsFirstTrace", () => {
  describe("given an application project that never received a trace", () => {
    it("awaits its first trace", () => {
      expect(projectAwaitsFirstTrace(project({ kind: "application" }))).toBe(true);
    });
  });

  describe("given an aggregate project with no first trace", () => {
    it("does not await one, since an aggregate receives none of its own", () => {
      expect(projectAwaitsFirstTrace(project({ kind: "aggregate" }))).toBe(false);
    });
  });

  describe("given a project that has received a trace", () => {
    it("does not await one", () => {
      expect(projectAwaitsFirstTrace(project({ hasFirstMessage: true }))).toBe(false);
    });
  });

  describe("given no project", () => {
    it("does not await one", () => {
      expect(projectAwaitsFirstTrace(undefined)).toBe(false);
    });
  });
});
