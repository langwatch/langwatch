import { createRestService } from "../builder.js";
import { RestVersionSelector } from "../rest-version-selector.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

function directService({
  basePath,
  pathVersion,
  selector = RestVersionSelector.create({ versions: ["v1"], latestVersion: "v1" }),
}: {
  basePath: string;
  pathVersion?: string;
  selector?: RestVersionSelector;
}) {
  return createRestService({
    name: "thing",
    basePath,
    logger: false,
    maxInputBytes: 1_024,
    staticVersioning: {
      selector,
      ...(pathVersion ? { pathVersion } : {}),
    },
    tracer: false,
  })
    .withoutPermission("framework test endpoint")
    .withoutRateLimit("framework test endpoint")
    .withoutResourceLimit("framework test endpoint")
    .get("/items", "2026-08-07", (endpoint) =>
      endpoint
        .withInput(z.object({}))
        .withOutput(z.object({ version: z.literal("v1") }))
        .handle(async () => ({ version: "v1" })),
    )
    .build();
}

describe("static REST generation routing", () => {
  it("mounts only the explicit v1 path and accepts its matching header", async () => {
    const app = directService({ basePath: "/api/v1/thing", pathVersion: "v1" });
    const response = await app.request("/api/v1/thing/items", {
      headers: { "X-API-Version": "v1" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-API-Version")).toBe("v1");
    expect(response.headers.get("X-API-Version-Status")).toBe("stable");
    expect((await app.request("/api/v1/thing/latest/items")).status).toBe(404);
    expect((await app.request("/api/v1/thing/2026-08-07/items")).status).toBe(404);
  });

  it("defaults an unversioned alias to latest and accepts a v1 header", async () => {
    const app = directService({ basePath: "/api/thing" });
    const latest = await app.request("/api/thing/items");
    const requested = await app.request("/api/thing/items", {
      headers: { "X-API-Version": "v1" },
    });

    expect(latest.headers.get("X-API-Version-Status")).toBe("latest");
    expect(requested.headers.get("X-API-Version-Status")).toBe("stable");
    expect((await requested.json()).version).toBe("v1");
  });

  it("returns a typed error for an unknown version", async () => {
    const app = directService({ basePath: "/api/thing" });
    const response = await app.request("/api/thing/items", {
      headers: { "X-API-Version": "v2" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_api_version" });
  });

  it("returns a typed conflict when path and header disagree", async () => {
    const app = directService({ basePath: "/api/v1/thing", pathVersion: "v1" });
    const response = await app.request("/api/v1/thing/items", {
      headers: { "X-API-Version": "v2" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "api_version_conflict" });
  });
});
