/**
 * @vitest-environment node
 * The playground keeps its released header wire contract while using the standard browser door.
 */
import { createErrorHandler } from "@langwatch/api";
import { createRestRuntime } from "@langwatch/api/rest";
import type {
  ModelProviderApi,
  ModelProviderPlaygroundCompletion,
  ModelProviderPlaygroundRequest,
} from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { playgroundRest } from "../playground.rest.ts";
import { mountableModelProviderApp } from "./model-provider.harness.ts";

const PROJECT_ID = "project-1";
const MODEL = "openai/gpt-5-mini";

function mount(
  options: {
    permitted?: boolean;
    projectHeader?: string;
    modelHeader?: string;
    modelProviders?: Partial<ModelProviderApi>;
    authorised?: unknown[];
  } = {},
) {
  const { app } = mountableModelProviderApp({ modelProviders: options.modelProviders ?? {} });
  const caller = {
    actor: { type: "user" as const, id: "user-1" },
    scope: null,
  };
  const identity = {
    identify: () => caller,
    authenticate: () => caller,
    authorize: ({ target }: { target: unknown }) => {
      options.authorised?.push(target);

      return { permitted: options.permitted ?? true, organizationRole: null };
    },
  };
  const hono = createRestRuntime({ identity }).mount(playgroundRest.router(), {
    app: () => app,
    onError: createErrorHandler(),
  });

  return (body: unknown = { messages: [] }, path = "/api/playground") =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-project-id": options.projectHeader ?? PROJECT_ID,
          "x-model": options.modelHeader ?? MODEL,
        },
        body: JSON.stringify(body),
      }),
    );
}

describe("the playground door", () => {
  it("checks playground:view against the parsed project header", async () => {
    const response = await mount({ permitted: false })();

    expect(response.status).toBe(403);
  });

  it("passes the released headers to the app operation while keeping project out of JSON", async () => {
    let received: ModelProviderPlaygroundRequest | undefined;
    const completion: ModelProviderPlaygroundCompletion = {
      status: 200,
      mediaType: "text/plain",
      headers: { "content-type": "text/plain" },
      body: (async function* () {
        yield new TextEncoder().encode("ok");
      })(),
    };
    const response = await mount({
      modelProviders: {
        runPlaygroundCompletion: async (input) => {
          received = input;

          return completion;
        },
      },
    })({ messages: [{ role: "user", content: "hello" }] });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
    expect(received).toEqual({
      projectId: PROJECT_ID,
      model: MODEL,
      systemPrompt: null,
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("runs the completion in the project the door authorised", async () => {
    const authorised: unknown[] = [];
    let received: ModelProviderPlaygroundRequest | undefined;
    const response = await mount({
      authorised,
      projectHeader: "project-from-door",
      modelProviders: {
        runPlaygroundCompletion: async (input) => {
          received = input;

          return {
            status: 200,
            mediaType: "text/plain",
            headers: { "content-type": "text/plain" },
            body: (async function* () {})(),
          };
        },
      },
    })();

    expect(response.status).toBe(200);
    expect(authorised).toEqual([{ tier: "project", id: "project-from-door" }]);
    expect(received?.projectId).toBe("project-from-door");
  });

  it("refuses a blank project header before the completion runs", async () => {
    let ran = false;
    const response = await mount({
      projectHeader: " ",
      modelProviders: {
        runPlaygroundCompletion: async () => {
          ran = true;
          throw new Error("must not run");
        },
      },
    })();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(ran).toBe(false);
  });

  it.each(["/api/v1/playground", "/api/playground"])(
    "answers the same completion at %s",
    async (path) => {
      const completion: ModelProviderPlaygroundCompletion = {
        status: 200,
        mediaType: "text/plain",
        headers: { "content-type": "text/plain" },
        body: (async function* () {
          yield new TextEncoder().encode("ok");
        })(),
      };
      const response = await mount({
        modelProviders: { runPlaygroundCompletion: async () => completion },
      })({ messages: [] }, path);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("ok");
    },
  );
});
