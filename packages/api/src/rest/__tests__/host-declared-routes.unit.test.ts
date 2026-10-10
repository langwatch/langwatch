/**
 * The REST host refuses to start serving while its application answers a route nothing declared.
 * @vitest-environment node
 * @see specs/security/api-endpoint-authorization.feature
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { publicRoute } from "../../access/access.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";

const read = () => ({ read: () => ({ ok: true }) });

function mountedHost() {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
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

  host.mount(
    defineRestRouter(moduleApi<{ read(): { ok: boolean } }>()("project"))
      .withNamespace("projects")
      .withVersion("2026-10-08")
      .get("/declared", "read")
      .withAccess(publicRoute({ reason: "the test reads nothing private" }))
      .withOutput(z.object({ ok: z.boolean() }))
      .handle(({ app }) => app.read())
      .build()
      .router(),
    read,
  );

  return host;
}

describe("a REST host about to start serving", () => {
  /** @scenario "The REST host refuses to serve a route nothing declared" */
  it("starts when every route it answers was declared", () => {
    expect(() => mountedHost().assertEveryRouteDeclared()).not.toThrow();
  });

  /** @scenario "The REST host refuses to serve a route nothing declared" */
  /** @scenario "A mounted route with no declared policy stops the boot" */
  it("refuses to start, naming the method and path of a route added beside the declarations", () => {
    const host = mountedHost();

    host.app.get("/api/projects/stray", (context) => context.json({}));
    host.app.post("/api/projects/stray", (context) => context.json({}));

    expect(() => host.assertEveryRouteDeclared()).toThrow(
      /GET \/api\/projects\/stray, POST \/api\/projects\/stray/,
    );
  });
});
