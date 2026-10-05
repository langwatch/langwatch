/**
 * Voice agent writes are refused while the project's `release_voice_agents_enabled` flag is off.
 * @see specs/features/agents/voice-agents-v1.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { createAgentAppFixture } from "./agent.fixture.ts";

const projectId = "project_1";
const voiceConfig = { transport: "elevenlabs_convai", agentId: "el_agent_1" } as const;

function voiceFlagFixture({ enabled }: { enabled: boolean }) {
  const isEnabled = vi.fn<FeatureFlagApi["isEnabled"]>().mockResolvedValue(enabled);
  const fixture = createAgentAppFixture({
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled }),
    projects: createApiFixture<ProjectApi>({ findOrganizationId: async () => "org_1" }),
  });

  return { ...fixture, isEnabled };
}

describe("AgentModule voice release flag", () => {
  describe("given a project with the release_voice_agents_enabled flag off", () => {
    describe("when a create request names type voice", () => {
      /** @scenario "Creating a voice agent is refused while the flag is off" */
      it("refuses it as forbidden and creates no agent", async () => {
        const { app, isEnabled } = voiceFlagFixture({ enabled: false });

        await expect(
          app.create({
            id: "agent_voice",
            projectId,
            name: "Support line",
            type: "voice",
            config: voiceConfig,
          }),
        ).rejects.toMatchObject({ code: "voice_agents_disabled", httpStatus: 403 });
        await expect(app.exists({ id: "agent_voice", projectId })).resolves.toBe(false);
        expect(isEnabled).toHaveBeenCalledWith("release_voice_agents_enabled", {
          kind: "project",
          projectId,
          organizationId: "org_1",
        });
      });
    });

    describe("when an update request names type voice", () => {
      /** @scenario "Updating an agent's type to voice is refused while the flag is off" */
      it("refuses it as forbidden and leaves the agent as it was", async () => {
        const { app, repositories } = voiceFlagFixture({ enabled: false });
        await app.create({
          id: "agent_prompt",
          projectId,
          name: "Prompt agent",
          type: "signature",
          config: { prompt: "Help the user" },
        });

        await expect(
          app.update({ id: "agent_prompt", projectId, type: "voice", config: voiceConfig }),
        ).rejects.toMatchObject({ code: "voice_agents_disabled", httpStatus: 403 });
        await expect(
          repositories.agents.getById({ id: "agent_prompt", projectId }),
        ).resolves.toMatchObject({ type: "signature", name: "Prompt agent" });
      });
    });

    describe("when an update request names no type", () => {
      /** @scenario "Updating a non-voice field does not check the voice flag" */
      it("renames a non-voice agent without asking the flag", async () => {
        const { app, isEnabled } = voiceFlagFixture({ enabled: false });
        await app.create({
          id: "agent_prompt",
          projectId,
          name: "Prompt agent",
          type: "signature",
          config: { prompt: "Help the user" },
        });

        await expect(
          app.update({ id: "agent_prompt", projectId, name: "Renamed" }),
        ).resolves.toMatchObject({ name: "Renamed" });
        expect(isEnabled).not.toHaveBeenCalled();
      });

      it("refuses a config-only save of a stored voice agent", async () => {
        const enabled = voiceFlagFixture({ enabled: true });
        await enabled.app.create({
          id: "agent_voice",
          projectId,
          name: "Support line",
          type: "voice",
          config: voiceConfig,
        });
        const { app } = createAgentAppFixture({
          repositories: enabled.repositories,
          featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
          projects: createApiFixture<ProjectApi>({ findOrganizationId: async () => "org_1" }),
        });

        await expect(
          app.update({ id: "agent_voice", projectId, config: voiceConfig }),
        ).rejects.toMatchObject({ code: "voice_agents_disabled" });
      });
    });

    describe("when a voice agent is copied into the project", () => {
      it("refuses the copy and creates nothing in the receiving project", async () => {
        const enabled = voiceFlagFixture({ enabled: true });
        await enabled.app.create({
          id: "agent_voice",
          projectId: "project_source",
          name: "Support line",
          type: "voice",
          config: voiceConfig,
        });
        const { app } = createAgentAppFixture({
          repositories: enabled.repositories,
          featureFlags: createApiFixture<FeatureFlagApi>({
            isEnabled: async (_flag, target) =>
              target.kind === "project" && target.projectId !== projectId,
          }),
          projects: createApiFixture<ProjectApi>({ findOrganizationId: async () => "org_1" }),
        });

        await expect(
          app.copy({
            sourceAgentId: "agent_voice",
            sourceProjectId: "project_source",
            targetProjectId: projectId,
            actorUserId: "user_1",
            newAgentId: "agent_copy",
          }),
        ).rejects.toMatchObject({ code: "voice_agents_disabled" });
        await expect(app.exists({ id: "agent_copy", projectId })).resolves.toBe(false);
      });
    });
  });

  describe("given a project with the release_voice_agents_enabled flag on", () => {
    it("creates a voice agent", async () => {
      const { app } = voiceFlagFixture({ enabled: true });

      await expect(
        app.create({
          id: "agent_voice",
          projectId,
          name: "Support line",
          type: "voice",
          config: voiceConfig,
        }),
      ).resolves.toMatchObject({ id: "agent_voice", type: "voice" });
    });
  });
});
