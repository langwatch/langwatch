import { CONTROL_REQUEST_TTL_MS } from "@langwatch/langy-contract";
import { SessionStateStoreFactory } from "@langwatch/redis-client";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
/**
 * The control request against the in-memory store, with a minter standing
 * in for the session key service: the flow is the same, and nothing here
 * needs a database to prove who may spend a request and how often.
 * @see specs/langy/langy-local-control.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { controlRequestKey } from "../../rules/langy-local-control-keys.rules.ts";
import {
  ControlRequestService,
  type StoredControlRequest,
} from "../langy-local-control-request.service.ts";

const projectId = "proj_1";
const userId = "user_1";
const conversationId = "conv_1";

let now = 1_700_000_000_000;
let store: SessionStateStore;
let mint: ReturnType<typeof vi.fn>;
let service: ControlRequestService;

/** The two project reads the service makes, and nothing else. */
const projects = {
  getOrganizationId: async () => "org_1",
  getSlug: async () => "acme-shop",
};

function create(
  overrides: Partial<{ userId: string; conversationId: string }> = {},
): Promise<StoredControlRequest> {
  return service.create({
    projectId,
    projectName: "ACME Shop",
    userId: overrides.userId ?? userId,
    conversationId: overrides.conversationId ?? conversationId,
    conversationTitle: "Instrument tracing",
    conversationUrl: "/?langyConversation=conv_1",
  });
}

beforeEach(() => {
  now = 1_700_000_000_000;
  store = SessionStateStoreFactory.memory({ now: () => now });
  mint = vi.fn(async () => ({ token: "sk-lw-minted", apiKeyId: "key_1" }));
  service = ControlRequestService.create({
    store,
    projects,
    now: () => now,
    mintSessionKey: mint as never,
  });
});

describe("given a code access card that asked for a folder", () => {
  describe("when the request is recorded", () => {
    it("binds it to the conversation, the user and the project", async () => {
      const request = await create();

      expect(request.conversationId).toBe(conversationId);
      expect(request.userId).toBe(userId);
      expect(request.projectId).toBe(projectId);
    });

    /** @scenario "Choosing the local folder records a request the CLI can find" */
    it("expires in fifteen minutes and the caller's own list finds it", async () => {
      const request = await create();

      expect(request.expiresAt - request.createdAt).toBe(CONTROL_REQUEST_TTL_MS);
      expect(CONTROL_REQUEST_TTL_MS).toBe(15 * 60 * 1000);
      const open = await service.listOpen({ projectId, userId });
      expect(open.map((row) => row.id)).toEqual([request.id]);
      expect(request.command).toContain("langy --share-control");
    });
  });

  describe("when the same conversation asks for the folder again", () => {
    /** @scenario "A new request replaces the conversation's older open request" */
    it("keeps only the newest, and leaves another conversation alone", async () => {
      const first = await create();
      const other = await create({ conversationId: "conv_2" });
      now += 30_000;
      const second = await create();

      const open = await service.listOpen({ projectId, userId });
      expect(open.map((row) => row.id).toSorted()).toEqual([second.id, other.id].toSorted());
      expect(await service.read(first.id)).toBeNull();
      await expect(
        service.approve({ requestId: first.id, userId, projectId }),
      ).rejects.toMatchObject({ code: "langy_local_request_invalid" });
    });
  });

  describe("when a teammate lists their own open requests", () => {
    /** @scenario "Another user never sees my request" */
    it("leaves mine out, and refuses their approval of it", async () => {
      const request = await create();

      const theirs = await service.listOpen({ projectId, userId: "user_2" });
      expect(theirs).toEqual([]);
      await expect(
        service.approve({ requestId: request.id, userId: "user_2", projectId }),
      ).rejects.toMatchObject({ code: "langy_local_request_invalid" });
    });
  });

  describe("when the command line approves it", () => {
    /** @scenario "Approving a request mints a session key for the conversation" */
    it("mints one session key and refuses a second approval", async () => {
      const request = await create();

      const approved = await service.approve({
        requestId: request.id,
        userId,
        projectId,
      });

      expect(approved.sessionKey).toBe("sk-lw-minted");
      expect(mint).toHaveBeenCalledWith({
        userId,
        projectId,
        organizationId: "org_1",
      });
      const binding = await service.readKeyBinding(approved.apiKeyId);
      expect(binding).toMatchObject({ conversationId, projectId, userId });
      expect(approved.projectSlug).toBe("acme-shop");

      await expect(
        service.approve({ requestId: request.id, userId, projectId }),
      ).rejects.toMatchObject({ code: "langy_local_request_invalid" });
      expect(mint).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the login is on another project than the conversation", () => {
    /** @scenario "A login on my personal project lists a request raised on a team project" */
    it("lists the request by the person, and approves it for the request's own project", async () => {
      const request = await create();

      const mine = await service.listOpen({ userId });
      expect(mine.map((row) => row.id)).toEqual([request.id]);
      expect(await service.listOpen({ userId, projectId: "proj_personal" })).toEqual([]);

      const approved = await service.approve({ requestId: request.id, userId });
      expect(mint).toHaveBeenCalledWith({
        userId,
        projectId,
        organizationId: "org_1",
      });
      expect(await service.readKeyBinding(approved.apiKeyId)).toMatchObject({ projectId });
      expect(approved.projectSlug).toBe("acme-shop");
    });

    it("refuses the approval when a named project is not the request's", async () => {
      const request = await create();

      await expect(
        service.approve({ requestId: request.id, userId, projectId: "proj_personal" }),
      ).rejects.toMatchObject({ code: "langy_local_request_invalid" });
    });
  });

  describe("when an approval already spent a request", () => {
    it("reports it as approved, even after the request itself is forgotten", async () => {
      const request = await create();
      expect(await service.wasApproved(request.id)).toBe(false);

      await service.approve({ requestId: request.id, userId, projectId });

      expect(await service.wasApproved(request.id)).toBe(true);
    });
  });

  describe("when the fifteen minutes have passed", () => {
    /** @scenario "An expired request is refused with the reason" */
    it("refuses the approval as expired, not as unknown", async () => {
      const request = await create();
      now += CONTROL_REQUEST_TTL_MS + 1;

      await expect(
        service.approve({ requestId: request.id, userId, projectId }),
      ).rejects.toMatchObject({ code: "langy_local_request_expired" });
    });
  });

  describe("when the developer refuses in the terminal", () => {
    /** @scenario "Cancelling a request from the terminal closes the card" */
    it("drops the request, so nothing is left to approve", async () => {
      const request = await create();

      await service.cancel({ requestId: request.id, userId, projectId });

      expect(await service.listOpen({ projectId, userId })).toEqual([]);
      await expect(
        service.approve({ requestId: request.id, userId, projectId }),
      ).rejects.toMatchObject({ code: "langy_local_request_invalid" });
    });
  });

  describe("when the panel closed the folder", () => {
    /** @scenario "Disconnecting from the panel revokes the key" */
    it("drops the binding, so the key controls no conversation", async () => {
      const request = await create();
      const approved = await service.approve({
        requestId: request.id,
        userId,
        projectId,
      });

      await service.revokeKeyBinding(approved.apiKeyId);

      expect(await service.readKeyBinding(approved.apiKeyId)).toBeNull();
    });

    /** @scenario "Disconnecting revokes the key even when the command line cannot be reached" */
    it("revokes every key of the conversation, knowing only the conversation", async () => {
      // What the panel has is a conversation, never a key id: it disconnects
      // from the header chip. Without this reading the credential outlived the
      // disconnect and the command line simply reconnected on it.
      const approved = await service.approve({
        requestId: (await create()).id,
        userId,
        projectId,
      });

      const revoked = await service.revokeConversationBindings(conversationId);

      expect(revoked).toEqual([approved.apiKeyId]);
      expect(await service.readKeyBinding(approved.apiKeyId)).toBeNull();
      expect(await service.revokeConversationBindings(conversationId)).toEqual([]);
    });
  });

  describe("when the card for one conversation is waiting", () => {
    it("finds that conversation's own open request and no other", async () => {
      const mine = await create();
      await create({ conversationId: "conv_2" });

      const found = await service.tryFindOpenForConversation({
        projectId,
        userId,
        conversationId,
      });

      expect(found?.id).toBe(mine.id);
    });
  });
});

describe("given a request in the caller's index that cannot be read", () => {
  it("skips the corrupt member and lists the rest", async () => {
    const readable = await create();
    const corrupt = await create({ conversationId: "conv_2" });
    await store.set(controlRequestKey(corrupt.id), "not json", 60);

    const open = await service.listOpen({ projectId, userId });

    expect(open.map((row) => row.id)).toEqual([readable.id]);
  });

  it("still throws when the failure is not the record's own corruption", async () => {
    const request = await create();
    const outage = new Error("redis connection reset");
    const brokenStore: SessionStateStore = {
      ...store,
      async tryGet(key: string) {
        if (key === controlRequestKey(request.id)) {
          throw outage;
        }

        return store.tryGet(key);
      },
    };
    const brokenService = ControlRequestService.create({
      store: brokenStore,
      projects,
      now: () => now,
      mintSessionKey: mint as never,
    });

    await expect(brokenService.listOpen({ projectId, userId })).rejects.toThrow(outage);
  });
});
