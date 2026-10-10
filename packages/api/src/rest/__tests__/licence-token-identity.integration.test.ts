import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { anyAuthenticated } from "../../access/access.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";
import { LicenceTokenIdentity, type LicenceTokenPresented } from "../licence-token-identity.ts";
import { bindRestCredential } from "../request.ts";

class TokenMalformedError extends HandledError {
  constructor() {
    super("connect_license_token_malformed", "the license token is malformed", { httpStatus: 401 });
  }
}

const sessionSchema = z.object({ licenseRowId: z.string() });

const Api = moduleApi<{
  sync(input: { organizationId: string; licenseRowId: string; members: number }): {
    organizationId: string;
    licenseRowId: string;
    members: number;
  };
}>()("licensing");

const declaration = defineRestRouter(Api)
  .withNamespace("licence-door")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("licence_token")
  .post("/api/licence-door/v1/sync", "licenceDoorSync")
  .withCredential("licence_token", { session: sessionSchema })
  .withInput(z.object({ members: z.number() }))
  .withAccess(anyAuthenticated({ reason: "the licence token door fixture" }))
  .withOutput(
    z.object({ organizationId: z.string(), licenseRowId: z.string(), members: z.number() }),
  )
  .handle(({ app, input, scope, session }) =>
    app.sync({
      organizationId: scope.id,
      licenseRowId: session.licenseRowId,
      members: input.members,
    }),
  )
  .build();

function hostWith({
  presented,
  bound = true,
}: {
  presented: LicenceTokenPresented[];
  bound?: boolean;
}) {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
    authz: authorizationPort.forRequest(),
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
  const door = LicenceTokenIdentity.create({
    verify: async (bearer) => {
      presented.push(bearer);
      if (bearer.authorization !== "Bearer lwl_live") throw new TokenMalformedError();

      return { organizationId: "organization-1", session: { licenseRowId: "license-1" } };
    },
  });
  host.mount(declaration.router(), () => ({ sync: (input: object) => input }), {
    facts: bound ? [bindRestCredential("licence_token", () => door)] : [],
  });

  return host;
}

function post(host: RestHost, headers: Record<string, string>, body = '{"members":3}') {
  return host.app.request("/api/licence-door/v1/sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("the licence token door", () => {
  describe("given a bearer the owning module accepts", () => {
    /** @scenario "The licence token door verifies a connect host bearer before the body" */
    it("hands the handler the holder's organization and session", async () => {
      const presented: LicenceTokenPresented[] = [];
      const response = await post(hostWith({ presented }), {
        authorization: "Bearer lwl_live",
        "x-langwatch-instance": "install-1",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        organizationId: "organization-1",
        licenseRowId: "license-1",
        members: 3,
      });
      expect(presented).toEqual([
        {
          authorization: "Bearer lwl_live",
          instanceId: "install-1",
          path: "/api/licence-door/v1/sync",
        },
      ]);
    });
  });

  describe("given a bearer the module refuses and a body that fails the schema", () => {
    /** @scenario "The licence token door verifies a connect host bearer before the body" */
    it("answers the module's own refusal, code and status intact, not the validation error", async () => {
      const response = await post(
        hostWith({ presented: [] }),
        { authorization: "Bearer LW-NOT-A-TOKEN" },
        '{"members":"many"}',
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "connect_license_token_malformed" });
    });
  });

  describe("given a family no module bound the door for", () => {
    /** @scenario "The licence token door verifies a connect host bearer before the body" */
    it("lets nobody in", async () => {
      const presented: LicenceTokenPresented[] = [];
      const response = await post(hostWith({ presented, bound: false }), {
        authorization: "Bearer lwl_live",
      });

      expect(response.status).toBe(404);
      expect(presented).toEqual([]);
    });
  });
});
