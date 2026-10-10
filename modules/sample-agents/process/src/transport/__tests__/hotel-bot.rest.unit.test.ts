/**
 * @vitest-environment node
 * The hotel bot's door through the REST runtime: the project API-key door asks `traces:create`
 * and hands the bot the verified project; a refusal comes out by code.
 */
import { ProjectInvalidCredentialsError } from "@langwatch/api";
import {
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
  ForbiddenError,
  recordProjectCredential,
} from "@langwatch/api/rest";
import {
  HotelBotDeclinedError,
  type HotelBotRunInput,
  type SampleAgentsApi,
} from "@langwatch/sample-agents-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { hotelBotRest } from "../hotel-bot.rest.ts";

const PROJECT_ID = "project-7";
const KEYS: Record<string, readonly string[]> = {
  "Bearer sk-lw-ingest": ["traces:create"],
  "Bearer sk-lw-read-only": ["traces:view"],
};

function mount(app: Partial<SampleAgentsApi>) {
  return createRestRuntime({
    authorization: restTestAuthorization(),
    identity: {
      authenticate: ({ request, permission }) => {
        const held = KEYS[request.headers.get("authorization") ?? ""];
        if (!held) throw new ProjectInvalidCredentialsError();
        if (!held.includes(permission)) throw new ForbiddenError();
        recordProjectCredential(request, {
          type: "apiKey",
          apiKeyId: "key-1",
          userId: "user-1",
          organizationId: "org-1",
          ingestSourceType: null,
          ingestionTemplateId: null,
          project: {
            id: PROJECT_ID,
            name: "Demo",
            slug: "demo",
            teamId: "team-1",
            organizationId: "org-1",
            isPersonal: false,
            ownerUserId: null,
            kind: "application",
          },
        });
        return {
          actor: { type: "api_key" as const, id: "key-1" },
          scope: { tier: "project" as const, id: PROJECT_ID },
        };
      },
    },
  }).mount(hotelBotRest.router(), {
    app: () => createApiFixture<SampleAgentsApi>(app),
    credential: "project",
    onError: createCanonicalFamilyErrorHandler({
      loggerName: "langwatch:test:hotel-bot",
      label: "Hotel bot",
    }),
  });
}

function callHotelBot({ key }: { key: string | null }) {
  return new Request("http://api.test/api/demo/hotel_bot", {
    method: "POST",
    headers: key ? { authorization: key } : {},
  });
}

describe("the hotel bot's door", () => {
  describe("given a caller without a key that may record traces", () => {
    /** @scenario "The hotel bot's door refuses a caller without a key that may record traces" */
    it.each([
      ["no key", null, 401],
      ["an unknown key", "Bearer sk-lw-unknown", 401],
      ["a key without traces:create", "Bearer sk-lw-read-only", 403],
    ])("answers %s %i and never runs the bot", async (_who, key, status) => {
      const runs: HotelBotRunInput[] = [];
      const hono = mount({
        runHotelBot: (input) => {
          runs.push(input);
          return Promise.resolve({ message: "Sent to LangWatch", ragResponse: "never" });
        },
      });

      const response = await hono.fetch(callHotelBot({ key }));

      expect(response.status).toBe(status);
      expect(runs).toEqual([]);
    });
  });

  describe("given a key holding traces:create", () => {
    /** @scenario "The door hands the key's project to the hotel bot" */
    it("runs the bot in the key's project and answers its reply", async () => {
      const runs: HotelBotRunInput[] = [];
      const hono = mount({
        runHotelBot: (input) => {
          runs.push(input);
          return Promise.resolve({ message: "Sent to LangWatch", ragResponse: "Try the bistro." });
        },
      });

      const response = await hono.fetch(callHotelBot({ key: "Bearer sk-lw-ingest" }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        message: "Sent to LangWatch",
        ragResponse: "Try the bistro.",
      });
      expect(runs).toEqual([
        { projectId: PROJECT_ID, startedByApiKeyId: "key-1", startedByUserId: "user-1" },
      ]);
    });

    /** @scenario "The door answers a declined run with its code" */
    it("answers a declined run as 401 with its code", async () => {
      const hono = mount({ runHotelBot: () => Promise.reject(new HotelBotDeclinedError()) });

      const response = await hono.fetch(callHotelBot({ key: "Bearer sk-lw-ingest" }));

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "demo_bot_declined" });
    });
  });
});
