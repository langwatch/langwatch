/**
 * What the `/api/model-providers` door makes of the failures its service
 * raises.
 * @vitest-environment node
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import {
  isSecretCredentialField,
  MASKED_KEY_PLACEHOLDER,
  ModelProviderNotFoundError,
  ModelProviderRoutingHandleTakenError,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import { ModelProviderKeysService } from "../../../services/model-provider-keys.service";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createModelProvidersRestApp } from "../model-provider.api";

/**
 * The process boundary, reduced to the one fact these tests read back: a
 * handled refusal keeps its own status and its own code.
 */
const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json({ error: serialized.code }, serialized.httpStatus as 400);
  }
  return c.json({ error: "internal_server_error" }, 500);
};

function testSecurity(): AppRestSecurity {
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

function buildApi(upsert: () => Promise<never>) {
  const modelProviders = {
    upsert: vi.fn(upsert),
    getForProject: vi.fn(async () => []),
  } as unknown as ModelProviderService;

  const organizations = {
    getTeamById: vi.fn(async () => ({ organizationId: "organization-1" })),
  } as unknown as OrganizationService;

  const family = createModelProvidersRestApp({
    security: testSecurity(),
    modelProviders: () => modelProviders,
    organizations: () => organizations,
  });

  return { hono: family.hono, modelProviders };
}

function upsertRequest() {
  return new Request("http://localhost/api/model-providers/openai", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
}

describe("the model-providers write route", () => {
  describe("when the service refuses with a not-found", () => {
    it("answers 404 with the failure's own code", async () => {
      const { hono } = buildApi(async () => {
        throw new ModelProviderNotFoundError();
      });

      const response = await hono.request(upsertRequest());

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: "model_provider_not_found",
      });
    });
  });

  describe("when the service refuses with a conflict", () => {
    it("answers 409 with the failure's own code", async () => {
      const { hono } = buildApi(async () => {
        throw new ModelProviderRoutingHandleTakenError({ handle: "taken" });
      });

      const response = await hono.request(upsertRequest());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: "model_provider_routing_handle_taken",
      });
    });
  });
});

/**
 * The stored rows, read back through the REAL credential policy — the same
 * masking the service applies before the door ever sees a provider. Stubbing
 * the masked shape instead would assert the stub.
 */
const STORED_CREDENTIALS: Record<string, Record<string, string>> = {
  openai: {
    OPENAI_API_KEY: "sk-plaintext-secret-123",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
  },
  bedrock: {
    AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    AWS_SECRET_ACCESS_KEY: "aws-secret-access-key-456",
    AWS_REGION_NAME: "us-east-1",
  },
};

function storedProviders() {
  const policy = ModelProviderKeysService.create();
  return Object.fromEntries(
    Object.entries(STORED_CREDENTIALS).map(([provider, keys]) => [
      provider,
      {
        id: `mp_${provider}`,
        provider,
        enabled: true,
        customKeys: policy.tryMask(keys),
        customModels: [],
        customEmbeddingsModels: [],
        models: null,
        embeddingsModels: null,
      },
    ]),
  );
}

function readableApi() {
  const upsert = vi.fn(async () => {});
  const getForProject = vi.fn(async () => storedProviders());
  const modelProviders = { upsert, getForProject } as unknown as ModelProviderService;
  const organizations = {
    getTeamById: vi.fn(async () => ({ organizationId: "organization-1" })),
  } as unknown as OrganizationService;

  const family = createModelProvidersRestApp({
    security: testSecurity(),
    modelProviders: () => modelProviders,
    organizations: () => organizations,
  });

  return { hono: family.hono, upsert, getForProject };
}

describe("the model-providers read route", () => {
  describe("when a project reads its providers", () => {
    /** @scenario "GET /api/model-providers lists providers with masked keys" */
    it("answers with every provider, credentials masked", async () => {
      const { hono } = readableApi();

      const response = await hono.request("http://localhost/api/model-providers");

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<
        string,
        { provider: string; enabled: boolean; customKeys: Record<string, string> }
      >;
      expect(Object.keys(body).sort()).toEqual(["bedrock", "openai"]);
      expect(body.openai?.customKeys.OPENAI_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
      expect(body.openai?.enabled).toBe(true);
    });

    /** @scenario "GET /api/model-providers returns no credential value for any provider" */
    it("returns no stored credential value, and still names which are set", async () => {
      const { hono } = readableApi();

      const response = await hono.request("http://localhost/api/model-providers");
      const serialized = await response.text();

      for (const keys of Object.values(STORED_CREDENTIALS)) {
        for (const [field, value] of Object.entries(keys)) {
          expect(serialized).toContain(field);
          if (isSecretCredentialField(field)) {
            expect(serialized).not.toContain(value);
          }
        }
      }
    });
  });
});

describe("the model-providers upsert route", () => {
  describe("when a project writes one provider", () => {
    /** @scenario "PUT /api/model-providers/:provider upserts provider config" */
    it("upserts it and answers with the re-read, masked list", async () => {
      const { hono, upsert, getForProject } = readableApi();

      const response = await hono.request(
        new Request("http://localhost/api/model-providers/openai", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: true, customKeys: { OPENAI_API_KEY: "sk-new" } }),
        }),
      );

      expect(response.status).toBe(200);
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: "sk-new" },
        }),
      );
      // The answer is the re-read, never an echo of what was sent.
      expect(getForProject).toHaveBeenCalledWith({ projectId: "project-1" });
      const body = (await response.json()) as Record<
        string,
        { customKeys: Record<string, string> }
      >;
      expect(body.openai?.customKeys.OPENAI_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
    });
  });
});
