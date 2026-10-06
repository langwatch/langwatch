/**
 * One module claims a prefixed namespace on a host (ARCHITECTURE.md §8, R10).
 * Spec: packages/api/specs/shared-path.feature.
 */
import { moduleApi, type ModuleName } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { publicRoute } from "../../access/access.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
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
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    audit: { record: async () => {} },
  });
}

const read = () => ({ read: () => ({ ok: true }) });

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
