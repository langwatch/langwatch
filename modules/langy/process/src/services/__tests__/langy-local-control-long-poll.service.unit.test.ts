import { createApiFixture } from "@langwatch/api-fixture";
/**
 * The long-poll share over the real session core, runtime and in-memory store: the session-key
 * door's check, and the instance token every later poll and post is addressed by.
 * @see specs/langy/langy-local-control.feature
 */
import type { ApiKeyApi, ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { LOCAL_CONTROL_PROTOCOL_VERSION, type RegisterFrame } from "@langwatch/langy-contract";
import { memorySessionState } from "@langwatch/process-stores";
import { beforeEach, describe, expect, it } from "vitest";

import { RedisLangyLocalControlRuntimeRepository } from "../../repositories/redis/redis.langy-local-control-runtime.repository.ts";
import { readSessionKeyCredential } from "../../rules/langy-local-control-connect.rules.ts";
import { LocalControlLongPollService } from "../langy-local-control-long-poll.service.ts";
import { LocalControlSessionCoreService } from "../langy-local-session.service.ts";

const projectId = "project_local";
const userId = "user_riley";
const conversationId = "conversation_1";
const PERSONAL_KEY = "sk-lw-personal";

let minted: Map<string, string>;
let runtime: ReturnType<typeof RedisLangyLocalControlRuntimeRepository.create>;
let longPoll: LocalControlLongPollService;

const apiKeys = createApiFixture<ApiKeyApi>({
  async findResolvedToken({ token }): Promise<ResolvedApiKeyCredential | null> {
    const apiKeyId = minted.get(token) ?? (token === PERSONAL_KEY ? "key_personal" : undefined);
    if (!apiKeyId) return null;
    return {
      type: "apiKey",
      apiKeyId,
      userId,
      organizationId: "org_1",
      ingestSourceType: null,
      ingestionTemplateId: null,
      isLangySessionKey: minted.has(token),
      project: {
        id: projectId,
        name: "Local",
        slug: "local",
        teamId: "team_1",
        organizationId: "org_1",
        isPersonal: false,
        ownerUserId: null,
      },
    };
  },
});

beforeEach(() => {
  minted = new Map();
  const store = memorySessionState();
  runtime = RedisLangyLocalControlRuntimeRepository.create({
    store,
    projects: { getOrganizationId: async () => "org_1", getSlug: async () => "local" },
    mintSessionKey: async () => {
      const token = `sk-lw-minted-${minted.size}`;
      minted.set(token, `key_${minted.size}`);
      return { token, apiKeyId: minted.get(token) ?? "" };
    },
    events: { startUserWait: async () => undefined, endUserWait: async () => undefined },
    buffer: RedisLangyLocalControlRuntimeRepository.nullBuffer(),
  });
  longPoll = LocalControlLongPollService.create({
    holdMs: 20,
    pollIntervalMs: 5,
    core: LocalControlSessionCoreService.create({
      apiKeys,
      readCredential: readSessionKeyCredential,
      actors: { user: { findUnique: async () => null } },
      baseHost: "https://app.test",
      store,
      presence: runtime.presence,
      dispatcher: runtime.dispatcher,
      waits: runtime.waits,
      requests: runtime.requests,
      turns: { start: async () => undefined },
      conversations: {
        findByIdVisible: async () => ({
          id: conversationId,
          title: "Instrument tracing",
          currentTurnId: null,
          lastModel: null,
        }),
        recordUserMessage: async () => ({ messageId: "message_1" }),
      },
      events: {
        connectLocalWorkspace: async () => undefined,
        disconnectLocalWorkspace: async () => undefined,
      },
      buffer: { appendLocalWorkspace: async () => undefined },
      skipGate: async () => ({ allowed: false }),
    }),
  });
});

async function approvedKey(): Promise<string> {
  const request = await runtime.requests.create({
    projectId,
    projectName: "Local",
    userId,
    conversationId,
    conversationTitle: "Instrument tracing",
    conversationUrl: `/?langyConversation=${conversationId}`,
  });
  const approved = await runtime.requests.approve({ requestId: request.id, userId, projectId });
  return approved.sessionKey;
}

const registerFrame: RegisterFrame = {
  protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
  type: "register",
  cli: { name: "langwatch", version: "1.0.0" },
  instance: {
    id: "lci_instance",
    hostname: "riley-mbp",
    username: "dev",
    pid: 4242,
    startedAt: "2026-09-25T12:00:00.000Z",
    inFlightCallIds: [],
  },
  workspace: { root: "/Users/dev/acme-app", name: "acme-app", os: "darwin" },
};

describe("the session-key door's check", () => {
  it("names the approving person and the key's project for a minted key", async () => {
    const token = await approvedKey();

    const holder = await longPoll.verifySessionKey({ token, projectId, instanceToken: null });

    expect(holder).toEqual({ actor: { type: "user", id: userId }, projectId });
  });

  it("refuses a key nobody minted as invalid", async () => {
    await expect(
      longPoll.verifySessionKey({ token: "sk-lw-guessed", projectId, instanceToken: null }),
    ).rejects.toMatchObject({ code: "langy_session_key_invalid" });
  });

  it("refuses the developer's own key as the wrong kind", async () => {
    await expect(
      longPoll.verifySessionKey({ token: PERSONAL_KEY, projectId, instanceToken: null }),
    ).rejects.toMatchObject({ code: "langy_session_key_wrong_type" });
  });
});

describe("a long-poll share", () => {
  it("is addressed by the instance token register hands out, until it is retired", async () => {
    const token = await approvedKey();
    const registered = await longPoll.register({
      authorization: `Bearer ${token}`,
      projectId,
      frame: registerFrame,
    });

    expect(registered.frame).toMatchObject({ type: "registered", instanceId: "lci_instance" });
    await expect(
      longPoll.poll({ instanceToken: registered.instanceToken, inFlightCallIds: [] }),
    ).resolves.toEqual({ frames: [] });
    await expect(
      longPoll.frames({
        instanceToken: registered.instanceToken,
        frames: [{ protocol: LOCAL_CONTROL_PROTOCOL_VERSION, type: "deregister" }],
      }),
    ).resolves.toEqual({ accepted: 1 });
    await expect(
      longPoll.poll({ instanceToken: registered.instanceToken, inFlightCallIds: [] }),
    ).rejects.toMatchObject({ code: "langy_local_record_not_found" });
  });

  it("refuses frames for an instance token this pod never handed out", async () => {
    await expect(
      longPoll.frames({ instanceToken: "lcs_unknown", frames: [] }),
    ).rejects.toMatchObject({ code: "langy_local_record_not_found" });
  });
});
