/**
 * @vitest-environment node
 * What `/api/model-defaults` refuses, and for whom.
 * @see specs/model-providers/model-default-config-cascade.feature
 */
import { bindRestMiddleware, createRestRuntime, canonicalErrorResponse } from "@langwatch/api/rest";
import type { AuthzPermission, PrincipalRef } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type {
  ModelDefaultApiKeyScopeCheck,
  ModelProviderApi,
  ModelDefaultConfig,
} from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ModelProviderAuthorizationService } from "../../services/model-provider-authorization.service.ts";
import { ModelProviderWriteAuthorizationService } from "../../services/model-provider-write-authorization.service.ts";
import { modelDefaultsRest, modelDefaultsRestCredential } from "../model-defaults.rest.ts";
import { mountableModelProviderApp } from "./model-provider.harness.ts";

const PROJECT = "project-1";
const ORGANIZATION = "organization-1";
const TEAM = "team-1";

/** The key's own ceiling refused it, exactly as the process's chain would. */
class ApiKeyPermissionDeniedTestError extends HandledError {
  declare readonly code: "api_key_permission_denied";

  constructor() {
    super("api_key_permission_denied", "The API key does not carry this permission", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ApiKeyPermissionDeniedTestError";
  }
}

type Credential = { principal: PrincipalRef; userId: string | null; organizationId: string } | null;

function mount(
  options: {
    credential?: Credential;
    /** Refuses the key's own ceiling for the permission the route named. */
    ceilingRefuses?: boolean;
    modelProviders?: Partial<ModelProviderApi>;
  } = {},
) {
  const asked: AuthzPermission[] = [];
  const credential: Credential =
    options.credential === undefined
      ? {
          principal: { type: "apiKey", id: "api-key-1" },
          userId: "owner-user",
          organizationId: ORGANIZATION,
        }
      : options.credential;

  const { app } = mountableModelProviderApp({ modelProviders: options.modelProviders ?? {} });
  const hono = createRestRuntime({
    identity: {
      authenticate: ({ permission }) => {
        asked.push(permission);

        if (options.ceilingRefuses) throw new ApiKeyPermissionDeniedTestError();

        return {
          actor: credential?.userId ? { type: "user", id: credential.userId } : null,
          scope: { tier: "project", id: PROJECT },
        };
      },
    },
  }).mount(modelDefaultsRest.router(), {
    app: () => app,
    credential: "project",
    onError: canonicalErrorResponse,
    facts: [bindRestMiddleware(modelDefaultsRestCredential, () => credential)],
  });

  const send = (method: string, path: string, body?: unknown) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  return { asked, send };
}

const writeBody = (scope: { scopeType: string; scopeId: string }) => ({
  config: { DEFAULT: "openai/gpt-5-mini" },
  scopes: [scope],
});

/** A project-bound access token, checked as the person it was issued to. */
const CLI_TOKEN: Credential = {
  principal: { type: "user", id: "owner-user" },
  userId: "owner-user",
  organizationId: ORGANIZATION,
};

const ORG_CONFIG: ModelDefaultConfig = {
  id: "config-1",
  config: { DEFAULT: "openai/gpt-5-mini" },
  scopes: [{ scopeType: "ORGANIZATION", scopeId: ORGANIZATION }],
  authorId: "owner-user",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const ORGANIZATION_WRITE = writeBody({ scopeType: "ORGANIZATION", scopeId: ORGANIZATION });

describe("given a project API key that names no user", () => {
  const writes = [
    ["creates", "POST", "/api/model-defaults", ORGANIZATION_WRITE],
    ["updates", "PUT", "/api/model-defaults/config-1", ORGANIZATION_WRITE],
    ["deletes", "DELETE", "/api/model-defaults/config-1", undefined],
  ] as const;

  for (const [verb, method, path, body] of writes) {
    describe(`when it ${verb} a default-model config`, () => {
      /** @scenario Saving with a key that names no user is refused with a handled error */
      it("refuses with a handled 403 naming model_default_user_key_required", async () => {
        const saveDefaultConfig = vi.fn(async () => ({ id: "config-1" }));
        const deleteDefaultConfig = vi.fn(async () => undefined);
        const { send } = mount({
          credential: null,
          modelProviders: {
            saveDefaultConfig: saveDefaultConfig as never,
            deleteDefaultConfig: deleteDefaultConfig as never,
          },
        });

        const response = await send(method, path, body);

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          code: "model_default_user_key_required",
        });
        expect(saveDefaultConfig).not.toHaveBeenCalled();
        expect(deleteDefaultConfig).not.toHaveBeenCalled();
      });
    });
  }
});

describe("given an API key whose ceiling does not reach the write", () => {
  describe("when it creates a default-model config", () => {
    /** @scenario "A narrow API key cannot write model defaults with its owner's grants" */
    it("refuses with the permission-denied code and never reaches the application", async () => {
      const saveDefaultConfig = vi.fn(async () => ({ id: "config-1" }));
      const { send, asked } = mount({
        ceilingRefuses: true,
        modelProviders: { saveDefaultConfig: saveDefaultConfig as never },
      });

      const response = await send("POST", "/api/model-defaults", ORGANIZATION_WRITE);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: "api_key_permission_denied",
      });
      expect(saveDefaultConfig).not.toHaveBeenCalled();
      expect(asked).toContain("project:manage");
    });
  });
});

describe("given a project-restricted API key minted by an organization administrator", () => {
  /** Only the key's own project is reachable; its owner's wider grants are not. */
  function keyScopedToItsProject() {
    const authorization = ModelProviderAuthorizationService.create(
      createApiFixture<AuthzApi>({
        getApiKeyProjectDecision: async ({ projectId }: { projectId: string }) => {
          if (projectId !== PROJECT) {
            return { outcome: "denied" };
          }

          return {
            outcome: "allowed",
            scope: {
              projectId: PROJECT,
              teamId: TEAM,
              organizationId: ORGANIZATION,
            },
          };
        },
        hasApiKeyPermission: async () => false,
      }),
    );
    const writeAuthorization = ModelProviderWriteAuthorizationService.create(authorization);
    const saveDefaultConfig = vi.fn(async () => ({ id: "config-1" }));

    return {
      saveDefaultConfig,
      modelProviders: {
        saveDefaultConfig: saveDefaultConfig as never,
        assertApiKeyMayWriteDefaultScopes: ((input: ModelDefaultApiKeyScopeCheck) =>
          writeAuthorization.assertApiKeyCanWriteDefault(input.apiKey, input.scopes)) as never,
      },
    };
  }

  describe("when it writes a config scoped to the whole organization", () => {
    /** @scenario "A model-defaults write is authorized against the key, not its owner" */
    it("refuses with the scope-forbidden code and never reaches the write", async () => {
      const { saveDefaultConfig, modelProviders } = keyScopedToItsProject();
      const { send } = mount({ modelProviders });

      const response = await send("POST", "/api/model-defaults", ORGANIZATION_WRITE);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: "model_default_scope_forbidden",
      });
      expect(saveDefaultConfig).not.toHaveBeenCalled();
    });
  });

  describe("when it writes a config scoped to its own project", () => {
    /** @scenario "A model-defaults write the key itself may make is allowed" */
    it("saves the config, because the credential reaches that scope on its own", async () => {
      const { saveDefaultConfig, modelProviders } = keyScopedToItsProject();
      const { send } = mount({ modelProviders });

      const response = await send(
        "POST",
        "/api/model-defaults",
        writeBody({ scopeType: "PROJECT", scopeId: PROJECT }),
      );

      expect(response.status).toBe(200);
      expect(saveDefaultConfig).toHaveBeenCalledOnce();
    });
  });
});

describe("given a project-bound access token", () => {
  describe("when it names a scope outside its project", () => {
    /** @scenario A project-bound access token cannot write model defaults outside its project */
    it("refuses with model_default_scope_forbidden and never reaches the application", async () => {
      const saveDefaultConfig = vi.fn<ModelProviderApi["saveDefaultConfig"]>(
        async () => ORG_CONFIG,
      );
      const { send } = mount({ credential: CLI_TOKEN, modelProviders: { saveDefaultConfig } });

      const response = await send("POST", "/api/model-defaults", ORGANIZATION_WRITE);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: "model_default_scope_forbidden",
      });
      expect(saveDefaultConfig).not.toHaveBeenCalled();
    });
  });
});

describe("given a project-bound access token and an organization-scoped config", () => {
  const byId = [
    ["updates", "PUT", { config: { DEFAULT: "openai/gpt-5" } }],
    ["empties the scopes of", "PUT", { scopes: [] }],
    ["deletes", "DELETE", undefined],
  ] as const;

  for (const [verb, method, body] of byId) {
    describe(`when it ${verb} that config by id`, () => {
      /** @scenario A project-bound access token cannot update or delete a model default outside its project */
      it("refuses with model_default_scope_forbidden and never reaches the application", async () => {
        const saveDefaultConfig = vi.fn<ModelProviderApi["saveDefaultConfig"]>(
          async () => ORG_CONFIG,
        );
        const deleteDefaultConfig = vi.fn<ModelProviderApi["deleteDefaultConfig"]>(
          async () => undefined,
        );
        const { send } = mount({
          credential: CLI_TOKEN,
          modelProviders: {
            findDefaultConfig: async () => ORG_CONFIG,
            saveDefaultConfig,
            deleteDefaultConfig,
          },
        });

        const response = await send(method, "/api/model-defaults/config-1", body);

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          code: "model_default_scope_forbidden",
        });
        expect(saveDefaultConfig).not.toHaveBeenCalled();
        expect(deleteDefaultConfig).not.toHaveBeenCalled();
      });
    });
  }
});
