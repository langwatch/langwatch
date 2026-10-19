import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { anyAuthenticated } from "../../access/access.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";
import { bindRestCredential } from "../request.ts";

const Api = moduleApi<{ read(): { ok: boolean } }>()("langy");
const declaration = defineRestRouter(Api)
  .withNamespace("internal")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("internal_secret")
  .get("/internal/read", "internal")
  .withAccess(anyAuthenticated({ reason: "module-owned internal credential" }))
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(({ app }) => app.read())
  .build();

function hostWithoutBearers() {
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

describe("a RestHost with no bearers option", () => {
  /** @scenario "A host given no deployment bearers refuses to mount an unbound internal family" */
  it("refuses to mount an internal family that binds no door of its own", () => {
    const read = vi.fn(() => ({ ok: true }));
    const server = hostWithoutBearers();

    expect(() => server.mount(declaration.router(), () => ({ read }))).toThrow(
      /"internal_secret", which nothing binds/,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("lets a family bind its own internal_secret door without the option", async () => {
    const server = hostWithoutBearers();

    server.mount(declaration.router(), () => ({ read: () => ({ ok: true }) }), {
      middlewareBindings: [
        bindRestCredential("internal_secret", () =>
          BearerIdentity.create({ name: "internal", token: "internal-marker" }),
        ),
      ],
    });

    const response = await server.app.request("/internal/read", {
      headers: { authorization: "Bearer internal-marker" },
    });

    expect(response.status).toBe(200);
  });
});
