import { describe, expect, it } from "vitest";

import {
  classifyEvent,
  classifyHang,
  classifyScreen,
  classifyStep,
  normalisePath,
  type RawEvent,
} from "../oracles.ts";
import { expandRoute, extractRoutes } from "../routes.ts";

const origin = "https://app.test";
const response = (status: number, path = "/api/trpc/traces.list?batch=1") =>
  classifyEvent({
    origin,
    event: { type: "response", status, method: "POST", url: origin + path, resourceType: "fetch" },
  });

describe("classifyEvent", () => {
  it("flags a 5xx as a server error", () => {
    expect(response(503)).toMatchObject({ kind: "server-error" });
  });

  it("flags a 4xx that is not an auth refusal", () => {
    expect(response(404)).toMatchObject({ kind: "client-error" });
    expect(response(400)).toMatchObject({ kind: "client-error" });
  });

  it("lets an auth refusal and the throttle through", () => {
    expect(response(401)).toBeUndefined();
    expect(response(403)).toBeUndefined();
    expect(response(429)).toBeUndefined();
    expect(response(200)).toBeUndefined();
  });

  it("ignores other origins and stream polling", () => {
    expect(
      classifyEvent({
        origin,
        event: {
          type: "response",
          status: 500,
          method: "GET",
          url: "https://other.test/x",
          resourceType: "fetch",
        },
      }),
    ).toBeUndefined();
    expect(response(500, "/api/things/stream")).toBeUndefined();
  });

  it("gives one signature to one cause across ids and queries", () => {
    const one = response(500, "/api/projects/cabcdefghijklmnopqrstu/traces?x=1");
    const two = response(500, "/api/projects/cvwxyzabcdefghijklmnop/traces?x=2");
    expect(one?.signature).toBe(two?.signature);
    expect(response(500, "/api/other")?.signature).not.toBe(one?.signature);
  });

  it("flags a page error and a console error, but not the browser's own load-failure line", () => {
    expect(
      classifyEvent({ origin, event: { type: "pageerror", message: "x is undefined" } }),
    ).toMatchObject({
      kind: "page-error",
    });
    expect(
      classifyEvent({ origin, event: { type: "console", text: "Boom 12", url: origin } }),
    ).toMatchObject({
      kind: "console-error",
    });
    expect(
      classifyEvent({
        origin,
        event: {
          type: "console",
          text: "Failed to load resource: the server responded with a status of 500",
          url: origin,
        },
      }),
    ).toBeUndefined();
  });

  it("flags a failed request, but not a navigation's abort", () => {
    const failed = (error: string) =>
      classifyEvent({
        origin,
        event: {
          type: "requestfailed",
          method: "GET",
          url: `${origin}/api/x`,
          error,
          resourceType: "fetch",
        },
      });
    expect(failed("net::ERR_CONNECTION_RESET")).toMatchObject({ kind: "request-failed" });
    expect(failed("net::ERR_ABORTED")).toBeUndefined();
  });
});

describe("classifyStep", () => {
  const moduleFailure: RawEvent = {
    type: "requestfailed",
    method: "GET",
    url: `${origin}/@fs/repo/modules/x.ts`,
    error: "net::ERR_HTTP2_PROTOCOL_ERROR",
    resourceType: "script",
  };
  const pageError: RawEvent = { type: "pageerror", message: "Module x did not load" };
  const serverError: RawEvent = {
    type: "response",
    status: 500,
    method: "GET",
    url: `${origin}/api/x`,
    resourceType: "fetch",
  };

  it("keeps every finding of a step in which nothing failed to load", () => {
    const step = classifyStep({ events: [pageError, serverError], origin });
    expect(step.moduleFailure).toBe(false);
    expect(step.drafts.map((draft) => draft.kind)).toEqual(["page-error", "server-error"]);
  });

  it("drops the page's own errors when a module failed to load, and keeps the 5xx", () => {
    const step = classifyStep({ events: [moduleFailure, pageError, serverError], origin });
    expect(step.moduleFailure).toBe(true);
    expect(step.drafts.map((draft) => draft.kind)).toEqual(["server-error"]);
  });

  it("drops hot-reload chatter", () => {
    const chatter: RawEvent = {
      type: "console",
      text: "[vite] failed to connect to websocket",
      url: origin,
    };
    expect(classifyStep({ events: [chatter], origin }).drafts).toEqual([]);
  });
});

describe("classifyScreen", () => {
  const screen = (text: string, url = `${origin}/p/traces`) =>
    classifyScreen({ text, url, origin });

  it("flags a blank screen, an error boundary and a not-found page", () => {
    expect(screen("  \n")).toMatchObject({ kind: "blank-screen" });
    expect(screen("Something went wrong on our side. Try again in a moment.")).toMatchObject({
      kind: "error-boundary",
    });
    expect(screen("Page not found")).toMatchObject({ kind: "not-found" });
  });

  it("passes a working page and a page off the app", () => {
    expect(screen("Traces\nDatasets\nEvaluations")).toBeUndefined();
    expect(screen("", "https://elsewhere.test/")).toBeUndefined();
  });
});

describe("classifyHang and normalisePath", () => {
  it("names a hang by its action and route", () => {
    expect(classifyHang({ what: "still loading", url: `${origin}/p/traces?a=1` }).signature).toBe(
      "hang still /p/traces",
    );
  });

  it("collapses ids and numbers in a path", () => {
    expect(normalisePath("/api/projects/123456/x?y=1")).toBe("/api/projects/:id/x");
  });
});

describe("routes", () => {
  const table = `
    { path: "/auth/signin", page: "pages/auth/signin" },
    { path: "/admin", redirect: { from: "/admin", to: "/ops" } },
    {
      path: "/:project/datasets/:id",
      page: "pages/[project]/datasets/[id]",
    },
    { layout: "chrome", children: [{ path: "/:project", page: "pages/[project]" }] },`;

  it("reads page routes and skips redirects", () => {
    expect(extractRoutes(table)).toEqual(["/auth/signin", "/:project/datasets/:id", "/:project"]);
  });

  it("fills the project, takes fixtures, and skips what it cannot fill", () => {
    expect(expandRoute({ route: "/:project", slug: "fuzz" }).path).toBe("/fuzz");
    expect(
      expandRoute({ route: "/:project/datasets/:id", slug: "fuzz", fixtures: { id: "d1" } }).path,
    ).toBe("/fuzz/datasets/d1");
    expect(expandRoute({ route: "/:project/datasets/:id", slug: "fuzz" }).skipped).toMatch(/:id/);
    expect(expandRoute({ route: "/x/*", slug: "fuzz" }).skipped).toBe("wildcard");
  });
});
