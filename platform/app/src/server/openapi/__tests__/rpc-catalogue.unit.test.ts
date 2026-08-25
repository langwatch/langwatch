/**
 * @vitest-environment node
 *
 * The root RPC catalogue is a projection of the mounted route tables, two
 * levels deep: it lists every service with the URL of that service's own
 * rpc.discover, and repeats no operation at the root. Every claim here follows
 * from it being derived rather than declared, which is why they are worth
 * pinning: the day someone "optimises" it into a registry, these stop holding.
 *
 * The per-operation rules — the name grammar, POST-only, nothing the document
 * does not carry — are pinned where they now live: the framework's own
 * rpc-discover.unit.test.ts in @langwatch/api.
 *
 * See packages/api/specs/api-discovery.feature.
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { buildRpcServiceIndex } from "../rpc-catalogue";

const OPENAPI_URL = "/.well-known/openapi";

/** A minimal app whose route table carries the given POST mounts. */
const appWithMounts = (paths: string[]): Hono => {
  const app = new Hono();
  for (const path of paths) {
    app.post(path, (c) => c.json({}));
  }
  return app;
};

const THINGS_LATEST = "/api/things/latest/rpc.discover";

describe("the root RPC catalogue", () => {
  /** @scenario "The root catalogue links to every service's catalogue" */
  it("lists every service with the URL of its own catalogue", () => {
    const index = buildRpcServiceIndex({
      apps: [
        appWithMounts([
          "/api/roles/2026-08-07/rpc.discover",
          "/api/roles/latest/rpc.discover",
        ]),
        appWithMounts([THINGS_LATEST]),
      ],
      openapiUrl: OPENAPI_URL,
    });

    expect(index.services).toEqual([
      { name: "roles", discover: "/api/roles/latest/rpc.discover" },
      { name: "things", discover: THINGS_LATEST },
    ]);
  });

  /** @scenario "The root catalogue links to every service's catalogue" */
  it("points at the OpenAPI document for the full surface", () => {
    const index = buildRpcServiceIndex({
      apps: [appWithMounts([THINGS_LATEST])],
      openapiUrl: OPENAPI_URL,
    });

    expect(index.openapi).toBe(OPENAPI_URL);
  });

  /** @scenario "The root catalogue links to every service's catalogue" */
  it("repeats no operation at the root", () => {
    const index = buildRpcServiceIndex({
      apps: [appWithMounts([THINGS_LATEST])],
      openapiUrl: OPENAPI_URL,
    });

    expect(index).not.toHaveProperty("operations");
    for (const entry of index.services) {
      expect(Object.keys(entry).sort()).toEqual(["discover", "name"]);
    }
  });

  it("skips a service whose catalogue mount does not exist", () => {
    // Derived, not declared: an app off the framework has no rpc.discover
    // mount, so the index cannot point at one. This is the claim that stops
    // the index drifting from the served surface.
    const index = buildRpcServiceIndex({
      apps: [appWithMounts(["/api/legacy/things.list"]), appWithMounts([THINGS_LATEST])],
      openapiUrl: OPENAPI_URL,
    });

    expect(index.services).toEqual([{ name: "things", discover: THINGS_LATEST }]);
  });

  it("answers an empty fleet when no service is on the framework", () => {
    const index = buildRpcServiceIndex({ apps: [], openapiUrl: OPENAPI_URL });

    expect(index.services).toEqual([]);
    expect(index.openapi).toBe(OPENAPI_URL);
  });

  it("orders services by discover URL so the response is stable", () => {
    const index = buildRpcServiceIndex({
      apps: [
        appWithMounts(["/api/zeta/latest/rpc.discover"]),
        appWithMounts(["/api/alpha/latest/rpc.discover"]),
      ],
      openapiUrl: OPENAPI_URL,
    });

    expect(index.services.map((entry) => entry.name)).toEqual(["alpha", "zeta"]);
  });
});
