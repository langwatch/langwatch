/**
 * One module claims a prefixed namespace on a host (ARCHITECTURE.md §8, R10).
 * Spec: packages/api/specs/shared-path.feature.
 */
import { moduleApi, type ModuleName } from "@langwatch/module";
import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { publicRoute } from "../../access/access.ts";
import { getRoutePolicy } from "../../route-registry.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter, type RestSharedPath } from "../declaration.ts";
import { RestHost } from "../host.ts";

const VERSION = "2026-10-06";

function family({ module, path }: { module: ModuleName; path: string }) {
  return defineRestRouter(moduleApi<{ read(): { ok: boolean } }>()(module))
    .withNamespace("projects")
    .withVersion(VERSION)
    .get(path, "read")
    .withAccess(publicRoute({ reason: "the test reads nothing private" }))
    .withOutput(z.object({ ok: z.boolean() }))
    .handle(({ app }) => app.read())
    .build()
    .router();
}

function host() {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });

  return RestHost.create({
    authz: authorizationPort.forRequest(),
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      instance_admin: closed,
      browser: closed,
    },
    audit: { record: async () => {} },
  });
}

const read = () => ({ read: () => ({ ok: true }) });

const SHARED_VERSION = "2026-10-07";
const SHARED: RestSharedPath = {
  owner: "project",
  reason: "the door moved to api-key with its dated addresses unchanged",
  deprecate: "retired with the project REST v2",
};

/** A dated family answering which module served it; sharing `SHARED`'s owner when told to. */
function datedFamily({
  module,
  path,
  version,
  sharedPath,
}: {
  module: ModuleName;
  path: string;
  version: string;
  sharedPath?: RestSharedPath;
}) {
  const route = defineRestRouter(moduleApi<{ serve(): { served: string } }>()(module))
    .withNamespace("projects")
    .withVersion(version)
    .get(path, "serve");

  return (sharedPath ? route.withSharedPath(sharedPath) : route)
    .withAccess(publicRoute({ reason: "the test reads nothing private" }))
    .withOutput(z.object({ served: z.string() }))
    .handle(({ app }) => app.serve())
    .build()
    .router();
}

const serves = (module: string) => () => ({ serve: () => ({ served: module }) });

async function servedAt(server: RestHost, path: string) {
  const response = await server.app.request(path);

  return response.status === 200
    ? ((await response.json()) as { served: string }).served
    : response.status;
}

describe("a host mounting families that claim a namespace", () => {
  /** @scenario "A second module claiming a prefix another module claims is refused at mount" */
  it("refuses a second module's family on the same namespace, naming both modules", () => {
    const server = host();

    server.mount(family({ module: "project", path: "/owned" }), read);

    expect(() => server.mount(family({ module: "api-key", path: "/moved" }), read)).toThrow(
      /of api-key claims a namespace project already claims.*withSharedPath\(\{ owner: "project"/,
    );
  });

  /** @scenario "One module may mount several families on its own prefix" */
  it("answers both families of the same module on its namespace", async () => {
    const server = host();

    server.mount(family({ module: "project", path: "/first" }), read);
    server.mount(family({ module: "project", path: "/second" }), read);

    expect((await server.app.request("/api/projects/first")).status).toBe(200);
    expect((await server.app.request("/api/projects/second")).status).toBe(200);
  });
});

describe("a host mounting a dated family that shares another module's namespace", () => {
  const owner = () => datedFamily({ module: "project", path: "/owned", version: "2026-10-06" });
  const sharer = (sharedPath: RestSharedPath = SHARED) =>
    datedFamily({ module: "api-key", path: "/moved", version: SHARED_VERSION, sharedPath });

  /** @scenario "Two modules serve one dated namespace, each at every address of its own routes" */
  it.each([
    ["the owner first", true],
    ["the sharer first", false],
  ])("answers each route from its own handler at every address, %s", async (_, ownerFirst) => {
    const server = host();
    const mounts = [
      () => server.mount(owner(), serves("project")),
      () => server.mount(sharer(), serves("api-key")),
    ];

    for (const mount of ownerFirst ? mounts : mounts.toReversed()) mount();

    for (const [path, module] of [
      ["/api/projects/owned", "project"],
      ["/api/projects/2026-10-06/owned", "project"],
      ["/api/projects/latest/owned", "project"],
      ["/api/v1/projects/owned", "project"],
      ["/api/v1/projects/latest/owned", "project"],
      ["/api/projects/2026-12-01/owned", "project"],
      ["/api/projects/moved", "api-key"],
      ["/api/projects/2026-10-07/moved", "api-key"],
      ["/api/projects/latest/moved", "api-key"],
      ["/api/v1/projects/moved", "api-key"],
      ["/api/v1/projects/2026-10-07/moved", "api-key"],
      ["/api/projects/2026-12-01/moved", "api-key"],
    ] as const) {
      expect([path, await servedAt(server, path)]).toEqual([path, module]);
    }

    expect(await servedAt(server, "/api/projects/2026-10-01/moved")).toBe(404);
    expect(getRoutePolicy("GET", "/api/projects/moved")?.sharedPath).toEqual({
      ...SHARED,
      servedBy: "api-key",
    });
    expect(getRoutePolicy("GET", "/api/projects/owned")?.sharedPath).toBeUndefined();

    const published = Object.keys((await generateSpecs(server.app)).paths ?? {});
    expect(published.filter((path) => /\/(owned|moved)$/.test(path)).toSorted()).toEqual([
      "/api/v1/projects/moved",
      "/api/v1/projects/owned",
    ]);
  });

  /** @scenario "A dated family sharing a namespace with the wrong owner is refused at mount" */
  it("refuses a sharer naming another owner than the module claiming the namespace", () => {
    const server = host();

    server.mount(owner(), serves("project"));

    expect(() => server.mount(sharer({ ...SHARED, owner: "dataset" }), serves("api-key"))).toThrow(
      /of api-key sits under \/api\/projects, which project claims, but its shared path names dataset/,
    );
  });
});
