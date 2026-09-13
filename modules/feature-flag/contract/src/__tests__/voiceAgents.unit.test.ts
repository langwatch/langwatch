/**
 * @vitest-environment node
 * @unit
 *
 * The single server-side read of `release_voice_agents_enabled` (AC29): every
 * voice door asks {@link isVoiceAgentsEnabledForProject}, so the targeting
 * shape it builds — org passed through, org resolved when omitted, and the
 * orphan-project fallback — is pinned here in one place.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { FeatureFlagApi } from "../feature-flag.api.ts";
import { isVoiceAgentsEnabledForProject } from "../voiceAgents.ts";
import { VOICE_AGENTS_FLAG_KEY } from "../voiceAgents.message.ts";

function fakeFeatureFlags(isEnabledMock: ReturnType<typeof vi.fn>): FeatureFlagApi {
  return { isEnabled: isEnabledMock } as unknown as FeatureFlagApi;
}

describe("isVoiceAgentsEnabledForProject", () => {
  describe("given a project", () => {
    describe("when the organizationId is passed", () => {
      it("uses it and never resolves the project", async () => {
        const isEnabledMock = vi.fn().mockResolvedValue(true);
        const resolveOrganizationIdMock = vi.fn();

        const enabled = await isVoiceAgentsEnabledForProject({
          projectId: "project_1",
          organizationId: "org_1",
          featureFlags: fakeFeatureFlags(isEnabledMock),
          resolveOrganizationId: resolveOrganizationIdMock,
        });

        expect(enabled).toBe(true);
        expect(resolveOrganizationIdMock).not.toHaveBeenCalled();
        expect(isEnabledMock).toHaveBeenCalledWith(VOICE_AGENTS_FLAG_KEY, {
          kind: "project",
          projectId: "project_1",
          organizationId: "org_1",
        });
      });
    });

    describe("when the organizationId is omitted", () => {
      it("resolves it from the project", async () => {
        const isEnabledMock = vi.fn().mockResolvedValue(true);
        const resolveOrganizationIdMock = vi.fn().mockResolvedValue("org_resolved");

        await isVoiceAgentsEnabledForProject({
          projectId: "project_1",
          featureFlags: fakeFeatureFlags(isEnabledMock),
          resolveOrganizationId: resolveOrganizationIdMock,
        });

        expect(resolveOrganizationIdMock).toHaveBeenCalledWith("project_1");
        expect(isEnabledMock).toHaveBeenCalledWith(VOICE_AGENTS_FLAG_KEY, {
          kind: "project",
          projectId: "project_1",
          organizationId: "org_resolved",
        });
      });
    });

    describe("when the project is orphaned", () => {
      it("omits the organization id", async () => {
        const isEnabledMock = vi.fn().mockResolvedValue(true);
        const resolveOrganizationIdMock = vi.fn().mockResolvedValue(undefined);

        await isVoiceAgentsEnabledForProject({
          projectId: "project_1",
          featureFlags: fakeFeatureFlags(isEnabledMock),
          resolveOrganizationId: resolveOrganizationIdMock,
        });

        expect(isEnabledMock).toHaveBeenCalledWith(VOICE_AGENTS_FLAG_KEY, {
          kind: "project",
          projectId: "project_1",
        });
      });
    });

    describe("when no resolver is given and no organizationId is passed", () => {
      it("omits the organization id", async () => {
        const isEnabledMock = vi.fn().mockResolvedValue(true);

        await isVoiceAgentsEnabledForProject({
          projectId: "project_1",
          featureFlags: fakeFeatureFlags(isEnabledMock),
        });

        expect(isEnabledMock).toHaveBeenCalledWith(VOICE_AGENTS_FLAG_KEY, {
          kind: "project",
          projectId: "project_1",
        });
      });
    });
  });
});
