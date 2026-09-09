/**
 * @vitest-environment node
 *
 * The device-session half of local control over its real REST family:
 * `GET /api/langy/control/requests`, the approval that mints the session key,
 * the cancel, and the long-poll transport's answer to a token it does not
 * know. The real family, the real runtime over a process-memory state store;
 * what is faked is the credential resolution the process would have done and
 * the key mint, which this process composes to a refusal.
 *
 * @see specs/langy/langy-local-control.feature
 */
import { INSTANCE_TOKEN_HEADER } from "@langwatch/agent-contract";
import { SessionStateStoreFactory } from "@langwatch/redis-client";
import {
  LangyLocalControlRuntimeAdapter,
  LocalControlLongPoll,
  LocalControlSessionCoreService,
  type LocalControlRuntime,
} from "@langwatch/langy-server";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it } from "vitest";

import { openTestRestDoors } from "./support/rest-doors.harness.ts";

const project = { id: "project-1", slug: "acme", teamId: "team-1", name: "Acme" };
const OWNER = "user-1";
const conversationId = `conv_${nanoid(10)}`;

/** Who the credential resolves to on the next request. */
let actingUserId = OWNER;
let runtime: LocalControlRuntime;
let api: ReturnType<typeof mount>;

beforeEach(() => {
  actingUserId = OWNER;
  runtime = LangyLocalControlRuntimeAdapter.create({
    store: SessionStateStoreFactory.memory(),
    projects: { tryReadOrganizationId: async () => "organization-1" },
    mintSessionKey: async () => ({
      token: `sk-lw-${nanoid(48)}`,
      apiKeyId: `key_${nanoid(10)}`,
    }),
    events: { startUserWait: async () => undefined, endUserWait: async () => undefined },
    buffer: LangyLocalControlRuntimeAdapter.nullBuffer(),
  });
  api = mount();
});

function openRequest() {
  return runtime.requests.create({
    projectId: project.id,
    projectName: "Control Routes Project",
    userId: OWNER,
    conversationId,
    conversationTitle: "Instrument tracing",
    conversationUrl: `/?langyConversation=${conversationId}`,
  });
}

describe("given a control request Langy opened for me", () => {
  describe("when the command line lists the open requests", () => {
    /** @scenario "Choosing the local folder records a request the CLI can find" */
    it("shows mine with the conversation it belongs to", async () => {
      const request = await openRequest();
      const response = await api.fetch("/api/langy/control/requests");
      const body = (await response.json()) as { requests: { id: string }[] };

      expect(response.status).toBe(200);
      expect(body.requests).toContainEqual(
        expect.objectContaining({
          id: request.id,
          conversationId,
          conversationTitle: "Instrument tracing",
        }),
      );
    });

    /** @scenario "Another user never sees my request" */
    it("shows a teammate none of mine, and refuses their approval", async () => {
      const request = await openRequest();
      actingUserId = "user-2";

      const listed = await api.fetch("/api/langy/control/requests");
      const body = (await listed.json()) as { requests: { id: string }[] };
      expect(body.requests.map((row) => row.id)).not.toContain(request.id);

      const approved = await api.fetch(`/api/langy/control/requests/${request.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace: workspace() }),
      });
      expect(approved.status).toBe(404);
      expect(await refusalOf(approved)).toMatchObject({
        code: "langy_local_request_invalid",
      });
    });
  });

  describe("when the developer approves it in the terminal", () => {
    /** @scenario "Approving a request mints a session key for the conversation" */
    it("answers with the session key and refuses a second approval", async () => {
      const request = await openRequest();
      const response = await api.fetch(`/api/langy/control/requests/${request.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace: workspace() }),
      });
      const body = (await response.json()) as {
        sessionKey: string;
        conversation: { id: string };
      };

      expect(response.status).toBe(200);
      expect(body.sessionKey).toMatch(/^sk-lw-/);
      expect(body.conversation.id).toBe(conversationId);

      const again = await api.fetch(`/api/langy/control/requests/${request.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace: workspace() }),
      });
      expect(again.status).toBe(404);
    });
  });

  describe("when the developer refuses it in the terminal", () => {
    /** @scenario "Cancelling a request from the terminal closes the card" */
    it("drops the request, so nothing is left to approve", async () => {
      const request = await openRequest();
      const response = await api.fetch(`/api/langy/control/requests/${request.id}/cancel`, {
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(await runtime.requests.tryRead(request.id)).toBeNull();
    });
  });
});

describe("given a network that blocks WebSockets", () => {
  describe("when the command line polls with a token nobody knows", () => {
    /** @scenario "The connection survives a network blip" */
    it("answers 410, which is what sends it back to sharing again", async () => {
      const response = await api.fetch("/api/langy/control/connect/poll", {
        headers: { [INSTANCE_TOKEN_HEADER]: "lcs_nobody" },
      });

      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ frames: [] });
    });
  });
});

/** The register frame's environment checklist, as the approval carries it. */
/** A collaborator no route in this suite reaches, refused by name if one does. */
function refuseLangyDoor(capability: string): never {
  throw new Error(`this suite composed no ${capability}`);
}

function workspace() {
  return { root: "/Users/dev/acme-app", name: "acme-app", gitBranch: "main", os: "darwin" };
}

/** The refusal body of the canonical envelope: a code, and tips to print. */
async function refusalOf(response: Response): Promise<{ code: string; message: string }> {
  return (await response.json()) as { code: string; message: string };
}

function mount() {
  const hono = new Hono();
  const core = LocalControlSessionCoreService.create({
    apiKeys: { findResolvedToken: async () => null } as unknown as ApiKeyApi,
    readCredential: () => null,
    actors: { tryFindById: async () => null } as never,
    baseHost: "https://app.langwatch.test",
    store: runtime.store,
    presence: runtime.presence,
    dispatcher: runtime.dispatcher,
    waits: runtime.waits,
    requests: runtime.requests,
    conversations: {
      findByIdVisible: async () => null,
      recordUserMessage: async () => ({ messageId: "msg_1" }),
    },
    events: {
      connectLocalWorkspace: async () => undefined,
      disconnectLocalWorkspace: async () => undefined,
    },
    buffer: { appendLocalWorkspace: async () => undefined },
    turns: { start: async () => undefined },
    skipGate: async () => ({ allowed: false, provider: "", modelId: "" }),
  });
  const longPoll = new LocalControlLongPoll({ core });

  for (const app of openTestRestDoors({
    services: {},
    ports: {
      // The acting person each scenario names: local control answers a
      // teammate none of the caller's own requests.
      handlerManagedCredential: async () => ({
        ok: true as const,
        project,
        resolved: {
          type: "apiKey" as const,
          apiKeyId: "key-langy-control",
          userId: actingUserId,
          organizationId: "organization-1",
          ingestSourceType: null,
          ingestionTemplateId: null,
          project,
        },
        markUsed: () => {},
      }),
      rateLimit: async () => ({ allowed: true }),
      publicBaseUrl: "https://app.langwatch.test",
      langy: {
        // The turns door and the internal door are mounted unconditionally
        // beside local control, so both need ports that BUILD. Neither is
        // exercised here: the turns door refuses by name, and the internal
        // door holds no secret, which is the 503 an unconfigured deployment
        // answers with rather than an open gate.
        turns: {
          readCredential: () => null,
          apiKeys: () => refuseLangyDoor("the credential directory"),
          enforceCeiling: () => refuseLangyDoor("the key ceiling"),
          featureFlags: () => refuseLangyDoor("the flag store"),
          actors: () => refuseLangyDoor("the user directory"),
          langy: () => refuseLangyDoor("the Langy application"),
          openTurnBuffer: () => null,
        } as never,
        internal: {
          langy: () => refuseLangyDoor("the Langy application"),
          internalSecret: () => undefined,
          metrics: { turnResult: () => undefined, sessionKeyRevokeRefused: () => undefined },
        },
        localControl: {
          runtime: () => runtime,
          longPoll: () => longPoll,
          baseHost: "https://app.langwatch.test",
        },
      },
    },
  })) {
    hono.route("/", app);
  }

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}
