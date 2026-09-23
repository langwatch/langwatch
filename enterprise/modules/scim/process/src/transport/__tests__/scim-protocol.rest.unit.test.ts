// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/api-reference/scim-api-reference.feature
 *
 * SCIM Groups provision LangWatch access groups (the Group model), not Teams.
 * The /Schemas discovery copy is what an identity-provider administrator reads
 * when wiring provisioning, so it must name the right resource.
 */
import { bindRestMiddleware, canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type {
  ScimListResponse,
  ScimTokenEntitlement,
  ScimUser,
} from "@langwatch/enterprise-scim-contract";
import { ENTERPRISE_FEATURE_ERRORS } from "@langwatch/entitlement-contract";
import type { OrganizationSsoConnection } from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import {
  scimProtocolErrorHandler,
  scimProtocolRest,
  scimRestCredential,
} from "../scim-protocol.rest.ts";
import { ScimServiceFake, scimTestApp } from "./support/scim-app.fixture.ts";

const ORGANIZATION_ID = "org_acme";
const BEARER = "Bearer scim_token_acme";

/** The directory the twelve provisioning routes read, with one token minted. */
class DirectoryFake extends ScimServiceFake {
  override readonly verifyToken = vi.fn(
    async ({ token }: { token: string }): Promise<ScimTokenEntitlement> =>
      token === "scim_token_acme"
        ? {
            status: "ok",
            id: "scim_token_1",
            organizationId: ORGANIZATION_ID,
            connectionId: null,
          }
        : { status: "invalid_token" },
  );
  override readonly listUsers = vi.fn(async (): Promise<ScimListResponse<ScimUser>> => ({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 0,
    startIndex: 1,
    itemsPerPage: 100,
    Resources: [],
  }));
}

const RETIRED_CONNECTION_ID = "ssoc_removed";

/** The same directory, minted against a connection rather than organization-wide. */
class RetiredConnectionDirectory extends DirectoryFake {
  override readonly verifyToken = vi.fn(async ({ token }: { token: string }) =>
    token === "scim_token_acme"
      ? ({
          status: "ok",
          id: "scim_token_1",
          organizationId: ORGANIZATION_ID,
          connectionId: RETIRED_CONNECTION_ID,
        } as const)
      : ({ status: "invalid_token" } as const),
  );
}

function mount(
  onError = scimProtocolErrorHandler,
  options: { scim?: ScimServiceFake; connections?: OrganizationSsoConnection[] } = {},
) {
  const scim = options.scim ?? new DirectoryFake();
  const { app } = scimTestApp({ scim, connections: options.connections });
  const directories = new WeakMap<Request, { connectionId: string | null }>();

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("This family resolves its own credential.");
      },
      identify: ({ request }) =>
        app
          .authenticateDirectory({ authorization: request.headers.get("authorization") })
          .then((directory) => {
            directories.set(request, { connectionId: directory.connectionId });

            return {
              actor: { type: "api_key" as const, id: directory.id },
              scope: { tier: "organization" as const, id: directory.organizationId },
            };
          }),
    },
  });

  const hono = runtime.mount(scimProtocolRest.router(), {
    app: () => app,
    onError,
    facts: [
      bindRestMiddleware(scimRestCredential, (c) => {
        const directory = directories.get(c.req.raw);
        if (!directory) throw new Error("The directory door resolved no credential");

        return directory;
      }),
    ],
  });

  return {
    scim,
    get: (path: string, authorization?: string) =>
      hono.fetch(
        new Request(`http://api.test${path}`, {
          headers: authorization ? { authorization } : {},
        }),
      ),
    post: (path: string, body: string) =>
      hono.fetch(
        new Request(`http://api.test${path}`, {
          method: "POST",
          headers: { authorization: BEARER, "content-type": "application/scim+json" },
          body,
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

  describe("when a directory pushes a body that is not JSON", () => {
    it("answers 400 and files the refusal on the connection's request log", async () => {
      const { scim, post } = mount();

      const response = await post("/api/scim/v2/Users", "{not json");

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        status: "400",
        detail: "The request body could not be read as JSON",
      });
      expect(scim.recordRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORGANIZATION_ID,
          method: "POST",
          resource: "Users",
          status: 400,
          reason: "malformed_body",
        }),
      );
    });
  });

  describe("when a directory pushes a resource we would not accept", () => {
    it("names only the fields it refused, never the parser's own message", async () => {
      const { scim, post } = mount();

      const response = await post("/api/scim/v2/Groups", JSON.stringify({ schemas: [] }));

      expect(response.status).toBe(400);
      const answer = (await response.json()) as { detail: string };
      expect(answer.detail).toMatch(/^The resource is not valid: /);
      expect(answer.detail).toContain("displayName");
      expect(scim.recordRequest).toHaveBeenCalledWith(
        expect.objectContaining({ resource: "Groups", status: 400, reason: "invalid_resource" }),
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

  describe("when a provisioning route refuses at the process's own error boundary", () => {
    /** @scenario "A directory refusal answers its own status, never an unattributed 500" */
    it("answers the refusal's status, because the refusal is handled", async () => {
      const api = mount((error, context) => canonicalErrorResponse(error, context));

      const response = await api.get("/api/scim/v2/Users");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ code: "scim_protocol_refusal" });
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

  describe("when a directory pushes through a token whose connection was removed", () => {
    /** @scenario "Removing a connection ends the tokens issued against it" */
    it("refuses the push and retires every token issued against that connection", async () => {
      const scim = new RetiredConnectionDirectory();
      const api = mount(scimProtocolErrorHandler, { scim, connections: [] });

      const response = await api.get("/api/scim/v2/Users", BEARER);

      expect(response.status).toBe(401);
      expect(scim.revokeTokensForConnection).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        connectionId: RETIRED_CONNECTION_ID,
      });
      expect(scim.listUsers).not.toHaveBeenCalled();
    });

    /** @scenario "A token that names no connection is left exactly as it was" */
    it("asks nothing about a connection for a token that names none", async () => {
      const api = mount();

      const response = await api.get("/api/scim/v2/Users", BEARER);

      expect(response.status).toBe(200);
      expect(api.scim.revokeTokensForConnection).not.toHaveBeenCalled();
    });

    it("leaves a live connection's directory provisioning exactly as it was", async () => {
      const scim = new RetiredConnectionDirectory();
      const api = mount(scimProtocolErrorHandler, {
        scim,
        connections: [
          {
            connectionId: RETIRED_CONNECTION_ID,
            displayName: "Okta",
            providerId: "Okta",
            verifiedDomains: [],
            type: "oidc",
            state: "ACTIVE",
          },
        ],
      });

      const response = await api.get("/api/scim/v2/Users", BEARER);

      expect(response.status).toBe(200);
      expect(scim.revokeTokensForConnection).not.toHaveBeenCalled();
    });
  });

  describe("when the token is valid but the organization's plan does not include directory sync", () => {
    it("answers the protocol's own 403 document, not a 401 or a 404", async () => {
      class UnentitledDirectory extends ScimServiceFake {
        override readonly verifyToken = vi.fn(
          async (_input: { token: string }): Promise<ScimTokenEntitlement> => ({
            status: "plan_not_entitled",
            organizationId: ORGANIZATION_ID,
            connectionId: null,
          }),
        );
      }
      const { app } = scimTestApp({ scim: new UnentitledDirectory() });
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
        facts: [
          bindRestMiddleware(scimRestCredential, () => {
            throw new Error("The plan gate refuses before a handler ever reads this fact");
          }),
        ],
      });

      const response = await hono.fetch(
        new Request("http://api.test/api/scim/v2/Users", { headers: { authorization: BEARER } }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "403",
        detail: ENTERPRISE_FEATURE_ERRORS.SCIM,
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
