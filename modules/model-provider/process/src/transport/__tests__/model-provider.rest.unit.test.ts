/**
 * @vitest-environment node
 * What `/api/model-providers` publishes, and what it makes of a refusal.
 * @see specs/model-providers/provider-configuration.feature
 */
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import {
  isSecretCredentialField,
  MASKED_KEY_PLACEHOLDER,
  ModelProviderNotFoundError,
  ModelProviderRoutingHandleTakenError,
  type ModelProviderApi,
  type ModelProviderSummary,
} from "@langwatch/model-provider-contract";
import { describe, expect, it, vi } from "vitest";

import { ModelProviderKeysService } from "../../services/model-provider-keys.service.ts";
import { modelProviderRest } from "../model-provider.rest.ts";
import { mountableModelProviderApp } from "./model-provider.harness.ts";

const PROJECT_ID = "project-1";

/** A handled refusal at its own status, carrying its own code. */
const renderHandled: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json({ error: error.code }, error.httpStatus as 400);
  }

  return c.json({ error: "internal_server_error" }, 500);
};

/**
 * The stored rows read back through the REAL credential policy — the same
 * masking the application applies before the door ever sees a provider.
 * Stubbing the masked shape instead would assert the stub.
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
        customKeys: policy.toMaskedKeys(keys),
        customModels: [],
        customEmbeddingsModels: [],
        models: null,
        embeddingsModels: null,
      },
    ]),
  );
}

function summary(
  overrides: Partial<ModelProviderSummary> & Pick<ModelProviderSummary, "id" | "provider">,
): ModelProviderSummary {
  return {
    organizationId: "organization-1",
    name: overrides.provider,
    enabled: true,
    routingHandle: null,
    scopes: [],
    customKeys: null,
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    isSystem: false,
    embeddingsUnsupported: false,
    ...overrides,
  };
}

function mount(modelProviders: Partial<ModelProviderApi>) {
  const { app } = mountableModelProviderApp({ modelProviders });
  const hono = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user", id: "user-1" },
        scope: { tier: "project", id: PROJECT_ID },
      }),
    },
  }).mount(modelProviderRest.router(), {
    app: () => app,
    credential: "project",
    onError: renderHandled,
  });

  const send = (method: string, path: string, body?: unknown) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  return { get: (path: string) => send("GET", path), put: send.bind(null, "PUT") };
}

describe("the model-providers read route", () => {
  describe("when a project reads its providers", () => {
    /** @scenario "GET /api/model-providers lists providers with masked keys" */
    it("answers with every provider, credentials masked", async () => {
      const { get } = mount({ getForProject: (async () => storedProviders()) as never });

      const response = await get("/api/model-providers");

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<
        string,
        { provider: string; enabled: boolean; customKeys: Record<string, string> }
      >;
      expect(Object.keys(body).toSorted()).toEqual(["bedrock", "openai"]);
      expect(body.openai?.customKeys.OPENAI_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
      expect(body.openai?.enabled).toBe(true);
    });

    /** @scenario "Every provider entry carries the same keys, present or empty" */
    it("always carries disabledByDefault and extraHeaders, so no caller presence-checks", async () => {
      const { get } = mount({ getForProject: (async () => storedProviders()) as never });

      const response = await get("/api/model-providers");

      const body = (await response.json()) as Record<string, Record<string, unknown>>;
      for (const [name, entry] of Object.entries(body)) {
        expect(entry, name).toHaveProperty("disabledByDefault");
        expect(entry, name).toHaveProperty("extraHeaders");
        expect(typeof entry.disabledByDefault, name).toBe("boolean");
        expect(Array.isArray(entry.extraHeaders), name).toBe(true);
      }
    });

    it("answers a registry default without an id or custom models, and an empty stored list as null", async () => {
      const { get } = mount({
        getForProject: async () => ({
          openai: summary({ id: "mp_openai", provider: "openai" }),
          anthropic: summary({
            id: "system_anthropic",
            provider: "anthropic",
            enabled: false,
            models: ["anthropic/claude"],
            embeddingsModels: [],
            disabledByDefault: true,
            isSystem: true,
          }),
        }),
      });

      const body = (await (await get("/api/model-providers")).json()) as Record<
        string,
        Record<string, unknown>
      >;

      expect(body.anthropic).toEqual({
        provider: "anthropic",
        enabled: false,
        customKeys: null,
        deploymentMapping: null,
        models: ["anthropic/claude"],
        embeddingsModels: [],
        disabledByDefault: true,
        extraHeaders: [],
      });
      expect(body.openai).toMatchObject({
        id: "mp_openai",
        customModels: null,
        customEmbeddingsModels: null,
      });
    });

    /** @scenario "GET /api/model-providers returns no credential value for any provider" */
    it("returns no stored credential value, and still names which are set", async () => {
      const { get } = mount({ getForProject: (async () => storedProviders()) as never });

      const serialized = await (await get("/api/model-providers")).text();

      for (const keys of Object.values(STORED_CREDENTIALS)) {
        for (const field of Object.keys(keys)) {
          expect(serialized).toContain(field);
        }
      }
      const secretValues = Object.values(STORED_CREDENTIALS).flatMap((keys) =>
        Object.entries(keys).flatMap(([field, value]) =>
          isSecretCredentialField(field) ? [value] : [],
        ),
      );
      expect(secretValues.length).toBeGreaterThan(0);
      for (const value of secretValues) {
        expect(serialized).not.toContain(value);
      }
    });
  });
});

describe("the model-providers upsert route", () => {
  describe("when a project writes one provider", () => {
    /** @scenario "PUT /api/model-providers/:provider upserts provider config" */
    it("upserts it and answers with the re-read, masked list", async () => {
      const upsert = vi.fn(async () => undefined);
      const getForProject = vi.fn(async () => storedProviders());
      const { put } = mount({
        upsertUnattributed: upsert as never,
        getForProject: getForProject as never,
      });

      const response = await put("/api/model-providers/openai", {
        enabled: true,
        customKeys: { OPENAI_API_KEY: "sk-new" },
      });

      expect(response.status).toBe(200);
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: "sk-new" },
        }),
      );
      // The answer is the re-read, never an echo of what was sent.
      expect(getForProject).toHaveBeenCalledWith({ projectId: PROJECT_ID });
      const body = (await response.json()) as Record<
        string,
        { customKeys: Record<string, string> }
      >;
      expect(body.openai?.customKeys.OPENAI_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
    });

    it("qualifies a bare default model with the provider the path named", async () => {
      const upsert = vi.fn(async () => undefined);
      const { put } = mount({
        upsertUnattributed: upsert as never,
        getForProject: (async () => ({})) as never,
      });

      await put("/api/model-providers/openai", { enabled: true, defaultModel: "gpt-5-mini" });

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ defaultModel: "openai/gpt-5-mini" }),
      );
    });
  });

  describe("when the application refuses with a not-found", () => {
    it("answers 404 with the failure's own code", async () => {
      const { put } = mount({
        upsertUnattributed: (async () => {
          throw new ModelProviderNotFoundError();
        }) as never,
        getForProject: (async () => ({})) as never,
      });

      const response = await put("/api/model-providers/openai", { enabled: true });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: "model_provider_not_found",
      });
    });
  });

  describe("when the application refuses with a conflict", () => {
    it("answers 409 with the failure's own code", async () => {
      const { put } = mount({
        upsertUnattributed: (async () => {
          throw new ModelProviderRoutingHandleTakenError({ handle: "taken" });
        }) as never,
        getForProject: (async () => ({})) as never,
      });

      const response = await put("/api/model-providers/openai", { enabled: true });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: "model_provider_routing_handle_taken",
      });
    });
  });
});
