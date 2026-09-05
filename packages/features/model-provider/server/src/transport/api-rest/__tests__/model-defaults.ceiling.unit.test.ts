/**
 * @vitest-environment node
 *
 * The API-key ceiling on the `/api/model-defaults` writes.
 *
 * The service authorizes each named scope against the key's OWNING USER, so a
 * deliberately narrow CI key repointed the organization's default and LANGY
 * models with its owner's grants. The three write routes declare the ceiling,
 * so the key's own scope caps the owner's; the read route is unchanged.
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createModelDefaultsRestApp } from "../model-defaults.api";

class ApiKeyPermissionDeniedTestError extends HandledError {
  constructor() {
    super("api_key_permission_denied", "denied", { httpStatus: 403, fault: "customer" });
  }
}

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json({ error: serialized.code }, serialized.httpStatus as 400);
  }
  return c.json({ error: "internal_server_error" }, 500);
};

/** The ceiling the process installs, refusing every permission the key lacks. */
function deniedCeiling(): {
  security: AppRestSecurity;
  asked: AuthzPermission[];
} {
  const asked: AuthzPermission[] = [];
  const pass: MiddlewareHandler = async (_c, next) => next();
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    c.set("project", {
      id: "project-1",
      name: "Project One",
      slug: "project-one",
      teamId: "team-1",
      organizationId: "organization-1",
      isPersonal: false,
      ownerUserId: null,
    });
    c.set("apiKeyUserId", "owner-user");
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: ({ permission }) => {
      asked.push(permission);
      return async () => {
        throw new ApiKeyPermissionDeniedTestError();
      };
    },
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };

  return { security: createAppRestSecurity(ports), asked };
}

function mount() {
  const saveDefaultConfig = vi.fn(async () => ({ id: "config-1" }));
  const deleteDefaultConfig = vi.fn(async () => undefined);
  const modelProviders = {
    saveDefaultConfig,
    deleteDefaultConfig,
  } as unknown as ModelProviderService;
  const { security, asked } = deniedCeiling();
  const family = createModelDefaultsRestApp({
    security,
    modelProviders: () => modelProviders,
  });

  return { hono: family.hono, saveDefaultConfig, deleteDefaultConfig, asked };
}

const WRITE_BODY = JSON.stringify({
  config: { DEFAULT: "openai/gpt-5-mini" },
  scopes: [{ scopeType: "ORGANIZATION", scopeId: "organization-1" }],
});

describe("given an API key whose ceiling does not reach the write", () => {
  describe("when it creates a default-model config", () => {
    /** @scenario "A narrow API key cannot write model defaults with its owner's grants" */
    it("refuses with the permission-denied code and never reaches the service", async () => {
      const { hono, saveDefaultConfig, asked } = mount();

      const response = await hono.request(
        new Request("http://localhost/api/model-defaults", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: WRITE_BODY,
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "api_key_permission_denied",
      });
      expect(saveDefaultConfig).not.toHaveBeenCalled();
      expect(asked).toContain("project:manage");
    });
  });

  describe("when it updates a default-model config", () => {
    /** @scenario "A narrow API key cannot write model defaults with its owner's grants" */
    it("refuses with the permission-denied code and never reaches the service", async () => {
      const { hono, saveDefaultConfig } = mount();

      const response = await hono.request(
        new Request("http://localhost/api/model-defaults/config-1", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: WRITE_BODY,
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "api_key_permission_denied",
      });
      expect(saveDefaultConfig).not.toHaveBeenCalled();
    });
  });

  describe("when it deletes a default-model config", () => {
    /** @scenario "A narrow API key cannot write model defaults with its owner's grants" */
    it("refuses with the permission-denied code and never reaches the service", async () => {
      const { hono, deleteDefaultConfig } = mount();

      const response = await hono.request(
        new Request("http://localhost/api/model-defaults/config-1", { method: "DELETE" }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "api_key_permission_denied",
      });
      expect(deleteDefaultConfig).not.toHaveBeenCalled();
    });
  });
});
