/**
 * @vitest-environment node
 * @unit
 *
 * Registering or repointing a voice agent through the API must refuse the
 * same way the UI does when `release_voice_agents_enabled` is off for the
 * project — the flag is not a UI-only decoration that a direct tRPC call
 * could bypass.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { agentsRouter } from "../agents";

vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import(
    "~/test-utils/appPermissionsMock"
  );
  return appPermissionsMock();
});

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasProjectPermission: vi.fn(() => Promise.resolve(true)),
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  };
});

const isEnabledMock = vi.fn();
vi.mock("~/server/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/featureFlag")>();
  return {
    ...actual,
    featureFlagService: {
      isEnabled: (...args: unknown[]) => isEnabledMock(...args),
    },
  };
});

vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId: vi.fn(async () => "org_1"),
}));

describe("agentsRouter voice-agent gate", () => {
  let caller: ReturnType<typeof agentsRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = createInnerTRPCContext({
      session: { user: { id: "test-user-id" }, expires: "1" },
      req: undefined,
      res: undefined,
      permissionChecked: true,
      publiclyShared: false,
    });
    ctx.prisma = {} as unknown as PrismaClient;
    caller = agentsRouter.createCaller(ctx);
  });

  describe("given the project's release_voice_agents_enabled flag is off", () => {
    beforeEach(() => {
      isEnabledMock.mockResolvedValue(false);
    });

    /** @scenario "Creating a voice agent is refused while the flag is off" */
    it("refuses to create a voice agent", async () => {
      await expect(
        caller.create({
          projectId: "project_1",
          name: "Support line",
          type: "voice",
          config: { transport: "elevenlabs_convai", agentId: "el_agent" },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    /** @scenario "Updating an agent's type to voice is refused while the flag is off" */
    it("refuses to update an agent's type to voice", async () => {
      await expect(
        caller.update({
          id: "agent_1",
          projectId: "project_1",
          type: "voice",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("given the project's release_voice_agents_enabled flag is on", () => {
    beforeEach(() => {
      isEnabledMock.mockResolvedValue(true);
    });

    /** @scenario "Updating a non-voice field does not check the voice flag" */
    it("does not check the voice flag for an update naming no type", async () => {
      // The fake prisma has no repository behind it, so the update call
      // itself fails past the gate; only that it never reached the flag
      // check is under test here.
      await caller
        .update({ id: "agent_1", projectId: "project_1", name: "Renamed" })
        .catch(() => {
          // Expected: the fake prisma has nothing behind it.
        });
      expect(isEnabledMock).not.toHaveBeenCalled();
    });
  });
});
