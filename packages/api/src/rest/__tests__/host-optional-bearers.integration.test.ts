import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

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

describe("a RestHost with no bearers option", () => {
  /** @scenario "A host given no deployment bearers leaves an unbound internal family closed" */
  it("refuses every call to an internal family that binds no door of its own", async () => {
    const read = vi.fn(() => ({ ok: true }));
    const server = hostWithoutBearers();

    server.mount(declaration.router(), () => ({ read }));

    const response = await server.app.request("/internal/read", {
      headers: { authorization: "Bearer any-secret" },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(read).not.toHaveBeenCalled();
  });

  it("lets a family bind its own internal_secret door without the option", async () => {
    const server = hostWithoutBearers();

    server.mount(declaration.router(), () => ({ read: () => ({ ok: true }) }), {
      facts: [
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
