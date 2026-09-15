// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/api-reference/scim-api-reference.feature
 *
 * SCIM Groups provision LangWatch access groups (the Group model), not Teams.
 * The /Schemas discovery copy is what an identity-provider administrator reads
 * when wiring provisioning, so it must name the right resource.
 */
import { createRestRuntime } from "@langwatch/api/rest";
import { describe, expect, it, vi } from "vitest";

import { scimProtocolErrorHandler, scimProtocolRest } from "../scim-protocol.rest.ts";
import { ScimServiceFake, scimTestApp } from "./support/scim-app.fixture.ts";

const ORGANIZATION_ID = "org_acme";
const BEARER = "Bearer scim_token_acme";

/** The directory the twelve provisioning routes read, with one token minted. */
class DirectoryFake extends ScimServiceFake {
  override readonly verifyToken = vi.fn(async ({ token }: { token: string }) =>
    token === "scim_token_acme"
      ? ({ status: "ok", organizationId: ORGANIZATION_ID, connectionId: null } as const)
      : ({ status: "invalid_token" } as const),
  );
  override readonly listUsers = vi.fn(async () => ({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 0,
    startIndex: 1,
    itemsPerPage: 100,
    Resources: [],
  }));
}

function mount() {
  const scim = new DirectoryFake();
  const { app } = scimTestApp({ scim });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("This family resolves its own credential.");
      },
      identify: ({ request }) =>
        app
          .authenticateDirectory({ authorization: request.headers.get("authorization") })
          .then((scope) => ({
            actor: { type: "api_key" as const, id: "scim-directory-token" },
            scope: { tier: "organization" as const, id: scope.organizationId },
          })),
    },
  });

  const hono = runtime.mount(scimProtocolRest.router(), {
    app: () => app,
    onError: scimProtocolErrorHandler,
  });

  return {
    scim,
    get: (path: string, authorization?: string) =>
      hono.fetch(
        new Request(`http://api.test${path}`, {
          headers: authorization ? { authorization } : {},
        }),
      ),
  };
}

describe("Feature: SCIM API reference", () => {
  describe("when an identity provider requests GET /api/scim/v2/Schemas", () => {
    /** @scenario "The SCIM schema describes groups as access groups" */
    it("describes the Group resource as a LangWatch access group", async () => {
      const api = mount();
      const res = await api.get("/api/scim/v2/Schemas");

      expect(res.status).toBe(200);

      const body = (await res.json()) as { Resources: { id: string; description: string }[] };
      const groupSchema = body.Resources.find(
        (resource) => resource.id === "urn:ietf:params:scim:schemas:core:2.0:Group",
      );

      expect(groupSchema).toBeDefined();
      expect(groupSchema?.description).toBe("Group (maps to a LangWatch access group)");
      expect(groupSchema?.description).not.toContain("Team");
    });
  });
});

describe("given a directory holding this organization's SCIM bearer token", () => {
  describe("when it lists the organization's users", () => {
    it("reads the tenant off the credential rather than off the request", async () => {
      const api = mount();

      const response = await api.get("/api/scim/v2/Users", BEARER);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/scim+json");
      expect(api.scim.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID, startIndex: 1, count: 100 }),
      );
    });
  });

  describe("when a provisioning route is called with no bearer at all", () => {
    it("answers the protocol's own 401 document", async () => {
      const api = mount();

      const response = await api.get("/api/scim/v2/Users");

      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain("application/scim+json");
      await expect(response.json()).resolves.toEqual({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "401",
        detail: "Bearer token is required",
      });
      expect(api.scim.listUsers).not.toHaveBeenCalled();
    });
  });

  describe("when the bearer is not a token this deployment minted", () => {
    it("answers 401 rather than 403, so a bad token cannot probe a plan", async () => {
      const api = mount();

      const response = await api.get("/api/scim/v2/Users", "Bearer not-a-token");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        detail: "Bearer token is not valid",
      });
    });
  });
});

describe("given the SCIM 2.0 protocol declaration", () => {
  const declaration = scimProtocolRest.router();

  describe("when its addresses are read", () => {
    it("names the protocol generation in its own path, at /api/scim/v2", () => {
      expect(declaration.addressing).toBe("v1-in-path");
      expect(declaration.generation).toBe("v2");
      expect(declaration.namespace).toBe("scim");
    });

    it("declares the fifteen routes an identity provider calls", () => {
      expect(declaration.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
        "get /ServiceProviderConfig",
        "get /ResourceTypes",
        "get /Schemas",
        "get /Users",
        "post /Users",
        "get /Users/:id",
        "put /Users/:id",
        "patch /Users/:id",
        "delete /Users/:id",
        "get /Groups",
        "post /Groups",
        "get /Groups/:id",
        "put /Groups/:id",
        "patch /Groups/:id",
        "delete /Groups/:id",
      ]);
    });
  });

  describe("when the door each route answers behind is read", () => {
    it("keeps the three discovery routes public and the twelve behind the directory token", () => {
      expect(declaration.credential).toBe("scimToken");

      const kinds = Object.fromEntries(
        declaration.routes.map((route) => [route.operation, route.access?.kind]),
      );

      expect(kinds.scimGetServiceProviderConfig).toBe("public");
      expect(kinds.scimListResourceTypes).toBe("public");
      expect(kinds.scimListSchemas).toBe("public");
      expect(kinds.scimListUsers).toBe("authenticated");
      expect(kinds.scimListGroups).toBe("authenticated");
      expect(kinds.scimDeleteGroup).toBe("authenticated");
    });

    it("asks no RBAC permission of a token that carries none", () => {
      expect(declaration.routes.every((route) => route.permission === undefined)).toBe(true);
    });
  });
});
