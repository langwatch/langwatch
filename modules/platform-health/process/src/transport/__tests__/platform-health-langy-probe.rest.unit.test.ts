/** @see specs/langy/langy-health-canary.feature (Route — GET /api/health/langy) */
import { createApiFixture } from "@langwatch/api-fixture";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import {
  type LangyApi,
  LangyApiIdentityDeniedError,
  type LangyRestCaller,
} from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { LangyCanaryService } from "../../services/langy-canary.service.ts";
import { platformHealthLangyProbeRest } from "../platform-health-probe.rest.ts";

const PROJECT_ID = "project-1";
const KEY = "sk-lw-known";
const LIMITED_KEY = "sk-lw-no-langy-create";

class MissingCredentialError extends HandledError {
  constructor() {
    super("unauthorized", "no credential", { httpStatus: 401 });
  }
}

class CeilingDeniedError extends HandledError {
  constructor() {
    super("api_key_permission_denied", "permission denied", { httpStatus: 403 });
  }
}

function probe(options: { getRestCaller?: () => Promise<LangyRestCaller> } = {}) {
  const turnsStarted: string[] = [];
  const langy = createApiFixture<LangyApi>({
    getRestCaller:
      options.getRestCaller ??
      (async () => ({ dark: false, projectId: PROJECT_ID, userId: "owner-1" })),
    getRestActor: async ({ userId }) => ({ user: { id: userId } }),
    startConversationTurn: async (input) => {
      turnsStarted.push(input.idempotencyKey);
      return { conversationId: "conv-1", turnId: "turn-1" };
    },
    awaitTurnSettlement: async () => ({
      kind: "settled",
      settlement: { succeeded: true, outcome: "completed", text: "Hello!", error: null },
    }),
  });
  const canary = LangyCanaryService.create({ langy });
  const authenticate = (input: { request: Request; permission: string }) => {
    const token = input.request.headers.get("x-auth-token");
    if (!token) throw new MissingCredentialError();
    if (token === LIMITED_KEY || input.permission !== "langy:create")
      throw new CeilingDeniedError();
    return {
      actor: { type: "user" as const, id: "owner-1" },
      scope: { tier: "project" as const, id: PROJECT_ID },
      permission: input.permission,
    };
  };
  const hono = createRestRuntime({ identity: { authenticate } }).mount(
    platformHealthLangyProbeRest.router(),
    {
      app: () => ({
        probeLangy: (key) => canary.probe(key),
        probeWithProjectKey: () => {
          throw new Error("the Langy probe never reaches the project-keyed canaries");
        },
      }),
      onError: canonicalErrorResponse,
    },
  );

  return {
    turnsStarted,
    get: (headers: Record<string, string> = {}) =>
      hono.fetch(new Request("http://api.test/api/health/langy", { headers })),
  };
}

describe("GET /api/health/langy", () => {
  describe("when the request carries no project API key", () => {
    /** @scenario "A request with no credential is refused before any turn is started" */
    it("answers 401 and starts no turn", async () => {
      const api = probe();

      const response = await api.get();

      expect(response.status).toBe(401);
      expect(api.turnsStarted).toEqual([]);
    });
  });

  describe("when the key does not clear the langy:create ceiling", () => {
    /** @scenario "A key without langy:create is refused" */
    it("answers 403 and starts no turn", async () => {
      const api = probe();

      const response = await api.get({ "x-auth-token": LIMITED_KEY });

      expect(response.status).toBe(403);
      expect(api.turnsStarted).toEqual([]);
    });
  });

  describe("when the key's owner is outside the Langy cohort", () => {
    /** @scenario "A key whose owner is outside the Langy cohort is refused" */
    it("answers 403 with the denial's code and starts no turn", async () => {
      const api = probe({
        getRestCaller: async () => {
          throw new LangyApiIdentityDeniedError("langy_api_key_no_langy_access", "no Langy access");
        },
      });

      const response = await api.get({ "x-auth-token": KEY });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "langy_api_key_no_langy_access" });
      expect(api.turnsStarted).toEqual([]);
    });
  });

  describe("when the key clears every door", () => {
    it("starts the greeting turn and answers 200", async () => {
      const api = probe();

      const response = await api.get({ "x-auth-token": KEY });

      expect(response.status).toBe(200);
      expect(api.turnsStarted).toHaveLength(1);
    });
  });
});
