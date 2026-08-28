import { ApiVersionConflictError, InvalidApiVersionError } from "../errors.js";
import { restVersionSelectorMiddleware, RestVersionSelector } from "../rest-version-selector.js";
import { API_VERSION_HEADER } from "../types.js";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

describe("RestVersionSelector", () => {
  const selector = RestVersionSelector.create({
    versions: ["v1", "v2"],
    latestVersion: "v2",
  });

  it("uses the explicit path version", () => {
    expect(selector.select({ pathVersion: "v1" })).toEqual({ version: "v1", source: "path" });
  });

  it("uses a supported header when the path is unversioned", () => {
    expect(selector.headerName).toBe(API_VERSION_HEADER);
    expect(selector.select({ headerVersion: "v1" })).toEqual({
      version: "v1",
      source: "header",
    });
  });

  it("uses the configured latest version without a path or header", () => {
    expect(selector.select({})).toEqual({ version: "v2", source: "latest" });
  });

  it("rejects a conflicting explicit path and header", () => {
    expect(() => selector.select({ pathVersion: "v1", headerVersion: "v2" })).toThrow(
      ApiVersionConflictError,
    );
  });

  it.each([{ pathVersion: "v3" }, { headerVersion: "v3" }])(
    "rejects unknown versions: %o",
    (request) => {
      expect(() => selector.select(request)).toThrow(InvalidApiVersionError);
    },
  );

  it("rejects an invalid selector configuration", () => {
    expect(() => RestVersionSelector.create({ versions: [], latestVersion: "v1" })).toThrow(
      /at least one supported version/,
    );
    expect(() => RestVersionSelector.create({ versions: ["v1"], latestVersion: "v2" })).toThrow(
      /latestVersion must be supported/,
    );
  });

  it("applies static selection to a hand-mounted REST route", async () => {
    const app = new Hono()
      .use(
        "*",
        restVersionSelectorMiddleware({
          selector: RestVersionSelector.create({ versions: ["v1"], latestVersion: "v1" }),
        }),
      )
      .get("/things", (context) => context.json({ ok: true }));

    const latest = await app.request("/things");
    const pinned = await app.request("/things", { headers: { "X-API-Version": "v1" } });

    expect(latest.headers.get("X-API-Version")).toBe("v1");
    expect(latest.headers.get("X-API-Version-Status")).toBe("latest");
    expect(pinned.headers.get("X-API-Version-Status")).toBe("stable");
  });
});
