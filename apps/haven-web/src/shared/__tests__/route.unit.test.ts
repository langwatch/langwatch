import { describe, expect, it } from "vitest";

import { logsPath, readRoute } from "../route.ts";

describe("readRoute", () => {
  it.each([
    ["hub.langwatch.localhost", "/", { kind: "hub", page: "overview" }],
    ["langwatch.localhost", "/", { kind: "hub", page: "overview" }],
    ["localhost", "/", { kind: "hub", page: "overview" }],
    ["127.0.0.1", "/", { kind: "hub", page: "overview" }],
    [
      "hub.langwatch.localhost",
      "/logs/feat-x/api",
      { kind: "hub", page: "logs", stack: "feat-x", lane: "api" },
    ],
    ["hub.langwatch.localhost", "/settings", { kind: "hub", page: "settings" }],
    ["hub.langwatch.localhost", "/logs", { kind: "hub", page: "logs", stack: "", lane: "" }],
    ["feat-x.langwatch.localhost", "/", { kind: "home", slug: "feat-x" }],
    ["Feat-X.langwatch.localhost", "/anything", { kind: "home", slug: "feat-x" }],
  ])("reads %s%s", (hostname, pathname, route) => {
    expect(readRoute({ hostname, pathname })).toEqual(route);
  });
});

describe("logsPath", () => {
  it("names the stack and the lane, and drops a lane without a stack", () => {
    expect(logsPath({ stack: "feat-x", lane: "api" })).toBe("/logs/feat-x/api");
    expect(logsPath({ stack: "feat-x" })).toBe("/logs/feat-x");
    expect(logsPath({ lane: "api" })).toBe("/logs");
  });
});
