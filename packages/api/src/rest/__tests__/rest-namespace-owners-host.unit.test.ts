/**
 * A literal route under another module's claimed prefix says so (ARCHITECTURE.md §8, R10).
 * Spec: packages/architecture-enforcer/specs/rest-namespace-owners.feature.
 */
import { moduleApi, type ModuleName } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { publicRoute } from "../../access/access.ts";
import { allRegisteredRoutes } from "../../route-registry.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter, type RestSharedPath } from "../declaration.ts";
import { RestHost } from "../host.ts";

const VERSION = "2026-10-06";
const read = () => ({ read: () => ({ ok: true }) });

function claimingFamily() {
  return defineRestRouter(moduleApi<{ read(): { ok: boolean } }>()("project"))
    .withNamespace("projects")
    .withVersion(VERSION)
    .get("/owned", "read")
    .withAccess(publicRoute({ reason: "the test reads nothing private" }))
    .withOutput(z.object({ ok: z.boolean() }))
    .handle(({ app }) => app.read())
    .build()
    .router();
}

function literalFamily({
  module,
  path,
  sharedPath,
}: {
  module: ModuleName;
  path: string;
  sharedPath?: RestSharedPath;
}) {
  const route = defineRestRouter(moduleApi<{ read(): { ok: boolean } }>()(module))
    .withNamespace(`${module}-doors`)
    .withVersion(VERSION)
    .withAddressing("literal", { v1Twin: false })
    .get(path, "read");

  return (sharedPath ? route.withSharedPath(sharedPath) : route)
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

describe("a host mounting a literal route under another module's claimed prefix", () => {
  /** @scenario "A literal route under another module's claimed prefix is refused at mount" */
  it("refuses it after the claim, naming both modules, the path and the declaration", () => {
    const server = host();
    server.mount(claimingFamily(), read);

    expect(() =>
      server.mount(literalFamily({ module: "dashboard", path: "/api/projects/all/charts" }), read),
    ).toThrow(
      /GET \/api\/projects\/all\/charts of dashboard sits under \/api\/projects, which project claims; declare \.withSharedPath\(\{ owner: "project"/,
    );
  });

  /** @scenario "A literal route under another module's claimed prefix is refused at mount" */
  it("refuses the claim when the literal route mounted first", () => {
    const server = host();
    server.mount(literalFamily({ module: "dashboard", path: "/api/projects/all/charts" }), read);

    expect(() => server.mount(claimingFamily(), read)).toThrow(
      /of dashboard sits under \/api\/projects, which project claims/,
    );
  });

  /** @scenario "A literal route declaring a shared path with the claiming module is admitted" */
  it("answers both families once the route names the claimant", async () => {
    const server = host();
    server.mount(
      literalFamily({
        module: "dashboard",
        path: "/api/projects/shared/charts",
        sharedPath: { owner: "project", reason: "nested sub-resource", deprecate: "next version" },
      }),
      read,
    );
    server.mount(claimingFamily(), read);

    expect((await server.app.request("/api/projects/shared/charts")).status).toBe(200);
    expect((await server.app.request("/api/projects/owned")).status).toBe(200);
  });

  /** @scenario "A shared path naming a module other than the claimant is refused at mount" */
  it("refuses a shared path naming a third module, naming the claimant", () => {
    const server = host();
    server.mount(claimingFamily(), read);
    const wrongOwner = literalFamily({
      module: "dashboard",
      path: "/api/projects/all/charts",
      sharedPath: { owner: "dataset", reason: "wrong owner", deprecate: "next version" },
    });

    expect(() => server.mount(wrongOwner, read)).toThrow(
      /which project claims, but its shared path names dataset/,
    );
  });

  it("admits a literal route under a prefix nobody claims", () => {
    const server = host();
    server.mount(claimingFamily(), read);

    expect(() =>
      server.mount(literalFamily({ module: "billing", path: "/api/webhooks/stripe" }), read),
    ).not.toThrow();
  });
});

describe("a permanent shared path", () => {
  /** @scenario "A permanent shared path carries no deprecation plan" */
  it("registers its owner and reason and says it is permanent", () => {
    host().mount(
      literalFamily({
        module: "dashboard",
        path: "/api/projects/all/analytics/permanent",
        sharedPath: { owner: "project", reason: "nested analytics", permanent: true },
      }),
      read,
    );

    const route = allRegisteredRoutes().find(
      (registered) => registered.path === "/api/projects/all/analytics/permanent",
    );

    expect(route?.sharedPath).toEqual({
      owner: "project",
      reason: "nested analytics",
      permanent: true,
      servedBy: "dashboard",
    });
  });
});
