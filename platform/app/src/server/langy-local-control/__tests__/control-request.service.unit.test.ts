/**
 * The control request against the in-memory store, with a minter that stands
 * in for the session key service: the flow is the same, and nothing here needs
 * a database to prove who may spend a request and how often.
 *
 * @see specs/langy/langy-local-control.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  type AgentStateStore,
  createMemoryStateStore,
} from "~/server/connected-agents/state-store";
import { CONTROL_REQUEST_TTL_MS } from "../constants";
import {
  ControlRequestService,
  type StoredControlRequest,
} from "../control-request.service";

const projectId = "proj_1";
const userId = "user_1";
const conversationId = "conv_1";

let now = 1_700_000_000_000;
let store: AgentStateStore;
let mint: ReturnType<typeof vi.fn>;
let service: ControlRequestService;

/** The one project read the service makes, and nothing else. */
const prisma = {
  project: {
    findUnique: async () => ({ team: { organizationId: "org_1" } }),
  },
} as unknown as PrismaClient;

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
  store = createMemoryStateStore({ now: () => now });
  mint = vi.fn(async () => ({ token: "sk-lw-minted", apiKeyId: "key_1" }));
  service = new ControlRequestService({
    store,
    prisma,
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

      expect(request.expiresAt - request.createdAt).toBe(
        CONTROL_REQUEST_TTL_MS,
      );
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
      expect(open.map((row) => row.id).sort()).toEqual(
        [second.id, other.id].sort(),
      );
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

      await expect(
        service.approve({ requestId: request.id, userId, projectId }),
      ).rejects.toMatchObject({ code: "langy_local_request_invalid" });
      expect(mint).toHaveBeenCalledTimes(1);
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
  });

  describe("when the card for one conversation is waiting", () => {
    it("finds that conversation's own open request and no other", async () => {
      const mine = await create();
      await create({ conversationId: "conv_2" });

      const found = await service.findOpenForConversation({
        projectId,
        userId,
        conversationId,
      });

      expect(found?.id).toBe(mine.id);
    });
  });
});
