/**
 * @vitest-environment node
 * The playground door's own refusals, in the order it makes them.
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import {
  playgroundRest,
  playgroundRestCaller,
  playgroundRestExecutionProxy,
  playgroundRestModel,
  playgroundRestProject,
  playgroundRestSystemPrompt,
} from "../playground.rest.ts";
import { mountableModelProviderApp } from "./model-provider.harness.ts";

const PROJECT_ID = "project-1";

/** One stored row, as the execution listing hands it over. */
const disabledProvider = {
  id: "mp_openai",
  organizationId: "organization-1",
  provider: "openai",
  name: "OpenAI",
  enabled: false,
  routingHandle: null,
  scopes: [{ scopeType: "PROJECT" as const, scopeId: PROJECT_ID }],
  customKeys: null,
  customModels: [],
  customEmbeddingsModels: [],
  extraHeaders: [],
  rateLimitRpm: null,
  rateLimitTpm: null,
  rateLimitRpd: null,
  fallbackPriorityGlobal: null,
  providerConfig: null,
  deploymentMapping: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  models: null,
  embeddingsModels: null,
  isSystem: false,
  embeddingsUnsupported: false,
};

const renderUnknown: RestErrorHandler = (_error, c) =>
  c.json({ error: "internal_server_error" }, 500);

type Caller =
  | { kind: "anonymous" }
  | { kind: "signedIn"; userId: string; permitted: boolean };

function mount(
  options: {
    caller?: Caller;
    projectHeader?: string | null;
    modelHeader?: string | null;
    modelProviders?: Partial<ModelProviderService>;
  } = {},
) {
  const { app } = mountableModelProviderApp({ modelProviders: options.modelProviders ?? {} });
  const hono = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("the playground door resolves no credential");
      },
    },
  }).mount(playgroundRest.router(), {
    app: () => app,
    credential: "public",
    onError: renderUnknown,
    facts: [
      bindRestMiddleware(
        playgroundRestCaller,
        () => options.caller ?? { kind: "signedIn", userId: "user-1", permitted: true },
      ),
      bindRestMiddleware(playgroundRestProject, () =>
        options.projectHeader === undefined ? PROJECT_ID : options.projectHeader,
      ),
      bindRestMiddleware(playgroundRestModel, () =>
        options.modelHeader === undefined ? "openai/gpt-5-mini" : options.modelHeader,
      ),
      bindRestMiddleware(playgroundRestSystemPrompt, () => null),
      bindRestMiddleware(playgroundRestExecutionProxy, () => "http://nlp.test/go/proxy/v1"),
    ],
  });

  return (body: unknown = { messages: [] }) =>
    hono.fetch(
      new Request("http://api.test/api/playground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
}

describe("the playground door", () => {
  describe("given nobody is signed in", () => {
    describe("when a completion is asked for", () => {
      it("answers 401 in the sentence this door has always used", async () => {
        const response = await mount({ caller: { kind: "anonymous" } })();

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({
          error: "You must be logged in to access this endpoint.",
        });
      });
    });
  });

  describe("given a signed-in person", () => {
    describe("when the request names no project", () => {
      it("answers 400 before anything is read", async () => {
        const response = await mount({ projectHeader: null })();

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "Missing projectId header" });
      });
    });

    describe("when they hold no playground permission on that project", () => {
      it("answers 403", async () => {
        const response = await mount({
          caller: { kind: "signedIn", userId: "user-1", permitted: false },
        })();

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({
          error: "You do not have permission to access this endpoint.",
        });
      });
    });

    describe("when the request names no model", () => {
      it("answers 400", async () => {
        const response = await mount({ modelHeader: null })();

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "Missing model header" });
      });
    });

    describe("when the project has not configured that provider", () => {
      it("names the provider it could not find", async () => {
        const response = await mount({
          modelProviders: { getExecutionProviders: (async () => ({})) as never },
        })();

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          error: "Provider not configured: openai",
        });
      });
    });

    describe("when the configured provider is switched off", () => {
      it("says so, and says where to switch it on", async () => {
        const response = await mount({
          modelProviders: {
            getExecutionProviders: (async () => ({ openai: disabledProvider })) as never,
          },
        })();

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          error: "Provider openai is disabled, go to settings to enable it",
        });
      });
    });
  });
});
