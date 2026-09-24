/** @see specs/langy/langy-local-permissions.feature */
import type { LangyConversationDetail, LangyKeyCaller } from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryLangyRepositories } from "../../repositories/memory/memory.langy.repositories.ts";
import { RedisLangyLocalControlRuntimeRepository } from "../../repositories/redis/redis.langy-local-control-runtime.repository.ts";
import { LangyLocalWorkerService } from "../langy-local-worker.service.ts";

const PROJECT_ID = "project-123";
const USER_ID = "user-1";
const CONVERSATION_ID = "conversation-1";

const key: LangyKeyCaller = { actor: { type: "user", id: USER_ID }, projectId: PROJECT_ID };

function buildWorker(options: { own: boolean }) {
  const repositories = MemoryLangyRepositories.create();
  const recorded: string[] = [];
  const runtime = RedisLangyLocalControlRuntimeRepository.create({
    store: repositories.sessionState,
    projects: { getOrganizationId: async () => "organization-1", getSlug: async () => "project" },
    mintSessionKey: async () => ({ token: "sk-lw-test", apiKeyId: "key-2" }),
    events: {
      startUserWait: async () => void recorded.push("user_wait_started"),
      endUserWait: async () => void recorded.push("user_wait_ended"),
    },
    buffer: repositories.tokenBuffer.open({ redis: null }),
  });
  const detail: LangyConversationDetail = {
    id: CONVERSATION_ID,
    title: "Instrument tracing",
    isShared: !options.own,
    isOwn: options.own,
    lastActivityAt: nowInstant(),
    messageCount: 1,
    status: "idle",
    currentTurnId: null,
    lastError: null,
    lastModel: "gpt-5-mini",
    eventCursor: null,
  };
  const worker = LangyLocalWorkerService.create({
    runtime,
    commands: {
      requestLocalControl: async () => void recorded.push("local_control_requested"),
      changeLocalPolicy: async () => void recorded.push("local_policy_changed"),
    },
    workspace: {
      getCodeAccessPreference: async () => ({ preference: null }),
      getGithubInstallation: async () => ({ installed: false }),
      canSkipPermissions: async () => ({ allowed: false }),
    },
    callers: {
      getLocalCaller: async () => ({
        userId: USER_ID,
        projectId: PROJECT_ID,
        projectName: "Project",
        projectSlug: "project",
      }),
    },
    conversations: { findByIdVisible: async () => detail },
    baseHost: "https://app.langwatch.test",
  });
  return { worker, runtime, recorded };
}

describe("given a teammate shared their conversation with the project", () => {
  describe("when a Langy key of mine names that conversation", () => {
    /** @scenario "A key never reaches the folder of a teammate's shared conversation" */
    it("answers not found for a request, a call and a question, and records nothing", async () => {
      const { worker, runtime, recorded } = buildWorker({ own: false });
      const turn = { conversationId: CONVERSATION_ID, turnId: "turn-1" };

      const refusals = await Promise.all([
        worker.createControlRequest({ ...key, conversationId: CONVERSATION_ID }).catch((e) => e),
        worker
          .startCall({
            ...key,
            call: { ...turn, tool: "local_read", params: { path: "a.ts" } },
          })
          .catch((e) => e),
        worker
          .startWait({ ...key, wait: { ...turn, kind: "question", questions: [] } })
          .catch((e) => e),
        worker.getWorkspace({ ...key, conversationId: CONVERSATION_ID }).catch((e) => e),
      ]);

      expect(refusals.map((error: { code?: string }) => error.code)).toEqual([
        "langy_conversation_not_found",
        "langy_conversation_not_found",
        "langy_conversation_not_found",
        "langy_conversation_not_found",
      ]);
      expect(recorded).toEqual([]);
      expect(
        await runtime.requests.findOpenForConversation({
          projectId: PROJECT_ID,
          userId: USER_ID,
          conversationId: CONVERSATION_ID,
        }),
      ).toEqual([]);
    });
  });
});

describe("given my own conversation", () => {
  describe("when the worker opens a request to share a folder", () => {
    it("records the request and answers it with the command that approves it", async () => {
      const { worker, recorded } = buildWorker({ own: true });

      const created = await worker.createControlRequest({
        ...key,
        conversationId: CONVERSATION_ID,
      });

      expect(created.request.conversationId).toBe(CONVERSATION_ID);
      expect(created.command).toMatch(/langwatch/);
      expect(recorded).toEqual(["local_control_requested"]);
    });
  });

  describe("when the worker polls a call whose record has lapsed", () => {
    it("answers not found, which the worker reads as still pending", async () => {
      const { worker } = buildWorker({ own: true });

      const error = await worker.getCallAnswer({ ...key, callId: "call-gone" }).catch((e) => e);

      expect(error.code).toBe("langy_local_record_not_found");
    });
  });

  describe("when the worker polls a question whose record has lapsed", () => {
    it("answers not found", async () => {
      const { worker } = buildWorker({ own: true });

      const error = await worker.getWaitAnswer({ ...key, waitId: "wait-gone" }).catch((e) => e);

      expect(error.code).toBe("langy_local_record_not_found");
    });
  });
});
