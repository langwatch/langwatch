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
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FeatureFlagModule from "~/server/featureFlag";
import { NOT_TARGETED } from "../targeting";
import { isVoiceAgentsEnabledForProject } from "../voiceAgents";
import { VOICE_AGENTS_FLAG_KEY } from "../voiceAgents.message";

const isEnabledMock = vi.fn();
vi.mock("~/server/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<FeatureFlagModule>();
  return {
    ...actual,
    featureFlagService: {
      isEnabled: (...args: unknown[]) => isEnabledMock(...args),
    },
  };
});

const resolveOrganizationIdMock = vi.fn();
vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId: (...args: unknown[]) =>
    resolveOrganizationIdMock(...args),
}));

describe("isVoiceAgentsEnabledForProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEnabledMock.mockResolvedValue(true);
  });

  describe("given a project", () => {
    describe("when the organizationId is passed", () => {
      it("uses it and never resolves the project", async () => {
        const enabled = await isVoiceAgentsEnabledForProject({
          projectId: "project_1",
          organizationId: "org_1",
        });

        expect(enabled).toBe(true);
        expect(resolveOrganizationIdMock).not.toHaveBeenCalled();
        expect(isEnabledMock).toHaveBeenCalledWith(VOICE_AGENTS_FLAG_KEY, {
          distinctId: "project_1",
          projectId: "project_1",
          organizationId: "org_1",
        });
      });
    });

    describe("when the organizationId is omitted", () => {
      it("resolves it from the project", async () => {
        resolveOrganizationIdMock.mockResolvedValue("org_resolved");

        await isVoiceAgentsEnabledForProject({ projectId: "project_1" });

        expect(resolveOrganizationIdMock).toHaveBeenCalledWith("project_1");
        expect(isEnabledMock).toHaveBeenCalledWith(VOICE_AGENTS_FLAG_KEY, {
          distinctId: "project_1",
          projectId: "project_1",
          organizationId: "org_resolved",
        });
      });
    });

    describe("when the project is orphaned", () => {
      it("falls back to NOT_TARGETED", async () => {
        resolveOrganizationIdMock.mockResolvedValue(undefined);

        await isVoiceAgentsEnabledForProject({ projectId: "project_1" });

        expect(isEnabledMock).toHaveBeenCalledWith(VOICE_AGENTS_FLAG_KEY, {
          distinctId: "project_1",
          projectId: "project_1",
          organizationId: NOT_TARGETED,
        });
      });
    });
  });
});
