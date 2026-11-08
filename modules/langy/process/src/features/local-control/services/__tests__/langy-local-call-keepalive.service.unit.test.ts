/**
 * Which name the keepalive's activity line gives the machine a call runs on.
 * @see specs/langy/langy-local-control.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import type { ConnectedWorkspace } from "../../../../repositories/langy-local-presence.repository.ts";
import type { StoredLocalCall } from "../../../../rules/langy-local-call-record.rules.ts";
import { LANGY_LIVENESS } from "../../../../rules/langy-streaming-constants.rules.ts";
import { LocalCallKeepaliveService } from "../langy-local-call-keepalive.service.ts";

const createdAt = 1_752_600_100_000;
const now = createdAt + LANGY_LIVENESS.HEARTBEAT_INTERVAL_MS * 2;

const call = {
  callId: "lcc_1",
  projectId: "project_1",
  conversationId: "conv_1",
  turnId: "turn_1",
  state: "running",
  createdAt,
  deadlineAt: createdAt + 900_000,
  tool: "local_bash",
  params: { command: "uv run pytest -q" },
} as StoredLocalCall;

const workspace: ConnectedWorkspace = {
  conversationId: "conv_1",
  projectId: "project_1",
  userId: "user_ada",
  requestId: "lcr_1",
  instanceId: "lci_1",
  hostname: "ada-mbp",
  connectedAt: createdAt,
  lastSeenAt: createdAt,
  workspace: { root: "/Users/ada/acme-app", name: "acme-app", os: "darwin" },
};

async function activityLine({ users }: { users?: UserApi }): Promise<string> {
  const appendStatus = vi.fn().mockResolvedValue(undefined);
  const keepalive = LocalCallKeepaliveService.create({
    calls: { claimKeepaliveWindow: async () => true },
    presence: { getByConversationId: async () => workspace },
    buffer: { appendStatus, heartbeat: async () => undefined },
    ...(users ? { users } : {}),
    now: () => now,
    nameLookupMs: 20,
  });
  await keepalive.beater()(call);
  return appendStatus.mock.calls[0]![0].status;
}

const profile = (id: string, name: string | null) => ({
  id,
  name,
  email: "ada@example.com",
  emailVerified: true,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastLoginAt: null,
  deactivatedAt: null,
});

/** The user module, answering only for the person who shared the folder. */
const usersNaming = (name: string | null) =>
  createApiFixture<UserApi>({
    findById: async ({ id }) => (id === workspace.userId ? profile(id, name) : null),
  });

describe("LocalCallKeepaliveService", () => {
  describe("given the person who shared the folder has a name on record", () => {
    /** @scenario "The activity line says whose machine, never the command" */
    it("says the command runs on that person's machine", async () => {
      expect(await activityLine({ users: usersNaming("Ada Lovelace") })).toBe(
        "Running on Ada's machine",
      );
    });
  });

  describe("given no name on record", () => {
    /** @scenario "The activity line says whose machine, never the command" */
    it("names the machine", async () => {
      expect(await activityLine({ users: usersNaming(null) })).toBe("Running on ada-mbp");
    });

    it("names the machine when the name cannot be read", async () => {
      const users = createApiFixture<UserApi>({
        findById: async () => Promise.reject(new Error("db down")),
      });
      expect(await activityLine({ users })).toBe("Running on ada-mbp");
    });

    it("names the machine when the name does not come in time", async () => {
      const users = createApiFixture<UserApi>({ findById: () => new Promise(() => undefined) });
      expect(await activityLine({ users })).toBe("Running on ada-mbp");
    });

    it("names the machine when no reader was composed", async () => {
      expect(await activityLine({})).toBe("Running on ada-mbp");
    });
  });
});
