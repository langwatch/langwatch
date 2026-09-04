/**
 * @vitest-environment node
 *
 * @see specs/model-providers/model-default-config-cascade.feature
 *   ("Saving with a key that names no user is refused with a handled error")
 *
 * The default-models write gate walks the CALLER's role bindings, so it
 * needs a user to walk them for. A project API key names only a project; the
 * guard used to answer that with a plain `Error("Not authenticated")` that
 * collapsed to a 400. That is wrong at the customer twice over — the
 * request WAS authenticated, and "not authenticated" reads as a malformed
 * body, not as a scope-tier limitation. Every write route (create, update,
 * delete) checks `apiKeyUserId` before it ever reaches the service.
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createModelDefaultsRestApp } from "../model-defaults.api";

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json({ error: serialized.code }, serialized.httpStatus as 403);
  }
  return c.json({ error: "internal_server_error" }, 500);
};

/** A project API key: authenticated, but with no owning user to walk role bindings for. */
function projectOnlyKeySecurity(): AppRestSecurity {
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
    // No apiKeyUserId set — a project key names only a project.
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
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };

  return createAppRestSecurity(ports);
}

function mount() {
  const saveDefaultConfig = vi.fn(async () => ({ id: "config-1" }));
  const deleteDefaultConfig = vi.fn(async () => undefined);
  const modelProviders = {
    saveDefaultConfig,
    deleteDefaultConfig,
  } as unknown as ModelProviderService;
  const family = createModelDefaultsRestApp({
    security: projectOnlyKeySecurity(),
    modelProviders: () => modelProviders,
  });

  return { hono: family.hono, saveDefaultConfig, deleteDefaultConfig };
}

const WRITE_BODY = JSON.stringify({
  config: { DEFAULT: "openai/gpt-5-mini" },
  scopes: [{ scopeType: "ORGANIZATION", scopeId: "organization-1" }],
});

describe("given a project API key that names no user", () => {
  describe("when it creates a default-model config", () => {
    /** @scenario Saving with a key that names no user is refused with a handled error */
    it("refuses with a handled 403 naming model_default_user_key_required", async () => {
      const { hono, saveDefaultConfig } = mount();

      const response = await hono.request(
        new Request("http://localhost/api/model-defaults", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: WRITE_BODY,
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "model_default_user_key_required",
      });
      expect(saveDefaultConfig).not.toHaveBeenCalled();
    });
  });

  describe("when it updates a default-model config", () => {
    /** @scenario Saving with a key that names no user is refused with a handled error */
    it("refuses the same way", async () => {
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
        error: "model_default_user_key_required",
      });
      expect(saveDefaultConfig).not.toHaveBeenCalled();
    });
  });

  describe("when it deletes a default-model config", () => {
    /** @scenario Saving with a key that names no user is refused with a handled error */
    it("refuses the same way", async () => {
      const { hono, deleteDefaultConfig } = mount();

      const response = await hono.request(
        new Request("http://localhost/api/model-defaults/config-1", { method: "DELETE" }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "model_default_user_key_required",
      });
      expect(deleteDefaultConfig).not.toHaveBeenCalled();
    });
  });
});
