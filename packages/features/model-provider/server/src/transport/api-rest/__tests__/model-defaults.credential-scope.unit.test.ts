/**
 * A model-defaults write names its own target scopes, and the service checks
 * them against the KEY OWNER. This drives the route over the real scope
 * authorization to pin the second check: the same scopes asked of the
 * credential, so an administrator's project-restricted key cannot change what
 * the whole organization resolves.
 * @vitest-environment node
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import type { AuthzService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type {
  ModelDefaultApiKeyScopeCheck,
  ModelProviderService,
} from "@langwatch/model-provider-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { ModelProviderAuthorizationService } from "../../../services/model-provider-authorization.service.ts";
import { ModelProviderWriteAuthorizationService } from "../../../services/model-provider-write-authorization.service.ts";
import { createModelDefaultsRestApp } from "../model-defaults.api.ts";

const PROJECT = "project-1";
const ORGANIZATION = "organization-1";

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json({ error: serialized.code }, serialized.httpStatus as 400);
  }
  return c.json({ error: "internal_server_error" }, 500);
};

/**
 * The owner is an administrator — every scope permits their user — while the
 * key itself reaches only the project it resolved to.
 */
function engine(): AuthzService {
  return {
    getDecision: async () => ({ permitted: true }),
    hasApiKeyPermission: async () => false,
    getApiKeyProjectDecision: async ({ projectId }: { projectId: string }) => ({
      outcome: projectId === PROJECT ? "allowed" : "denied",
    }),
  } as unknown as AuthzService;
}

/** The process's chain, with the ceiling open so only the scope check can refuse. */
function security(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const project = {
    id: PROJECT,
    name: "Project One",
    slug: "project-one",
    teamId: "team-1",
    organizationId: ORGANIZATION,
    isPersonal: false,
    ownerUserId: null,
  };
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    c.set("project", project);
    c.set("apiKeyUserId", "owner-user");
    c.set("resolvedToken", {
      type: "apiKey",
      apiKeyId: "api-key-1",
      userId: "owner-user",
      organizationId: ORGANIZATION,
      ingestSourceType: null,
      ingestionTemplateId: null,
      project,
    });
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
  const writeAuthorization = ModelProviderWriteAuthorizationService.create(
    ModelProviderAuthorizationService.create(engine()),
  );
  const saveDefaultConfig = vi.fn(async () => ({ id: "config-1" }));
  const modelProviders = {
    saveDefaultConfig,
    assertApiKeyMayWriteDefaultScopes: (input: ModelDefaultApiKeyScopeCheck) =>
      writeAuthorization.assertApiKeyCanWriteDefault(input.apiKey, input.scopes),
  } as unknown as ModelProviderService;

  return {
    hono: createModelDefaultsRestApp({
      security: security(),
      modelProviders: () => modelProviders,
    }),
    saveDefaultConfig,
  };
}

function writeBody(scope: { scopeType: string; scopeId: string }): string {
  return JSON.stringify({ config: { DEFAULT: "openai/gpt-5-mini" }, scopes: [scope] });
}

describe("given a project-restricted API key minted by an organization administrator", () => {
  describe("when it writes a default-model config scoped to the whole organization", () => {
    /** @scenario "A model-defaults write is authorized against the key, not its owner" */
    it("refuses with the scope-forbidden code and never reaches the write", async () => {
      const { hono, saveDefaultConfig } = mount();

      const response = await hono.request(
        new Request("http://localhost/api/model-defaults", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: writeBody({ scopeType: "ORGANIZATION", scopeId: ORGANIZATION }),
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "model_default_scope_forbidden",
      });
      expect(saveDefaultConfig).not.toHaveBeenCalled();
    });
  });

  describe("when it writes a default-model config scoped to its own project", () => {
    /** @scenario "A model-defaults write the key itself may make is allowed" */
    it("saves the config, because the credential reaches that scope on its own", async () => {
      const { hono, saveDefaultConfig } = mount();

      const response = await hono.request(
        new Request("http://localhost/api/model-defaults", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: writeBody({ scopeType: "PROJECT", scopeId: PROJECT }),
        }),
      );

      expect(response.status).toBe(200);
      expect(saveDefaultConfig).toHaveBeenCalledOnce();
    });
  });
});
