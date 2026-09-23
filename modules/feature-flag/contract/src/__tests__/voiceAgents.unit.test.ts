/**
 * @vitest-environment node
 * @unit
 * Every voice door reads the flag through one function, so the targeting shape
 * is pinned here rather than at each door.
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { FeatureFlagApi } from "../feature-flag.api.ts";
import { VOICE_AGENTS_FLAG_KEY } from "../voiceAgents.message.ts";
import { isVoiceAgentsEnabledForProject } from "../voiceAgents.ts";

const unused = (name: string) => async (): Promise<never> => {
  throw new Error(`this suite does not call FeatureFlagApi.${name}`);
};

function fakeFeatureFlags(isEnabledMock: FeatureFlagApi["isEnabled"]): FeatureFlagApi {
  return {
    isEnabled: isEnabledMock,
    resolveFrontendFlags: unused("resolveFrontendFlags"),
    resolvePublicAnonymousFlags: unused("resolvePublicAnonymousFlags"),
    resolveExperimentCatalogue: unused("resolveExperimentCatalogue"),
    setUserExperimentEnrolment: unused("setUserExperimentEnrolment"),
    setExperimentTenantPolicy: unused("setExperimentTenantPolicy"),
    listOperatorCatalogue: unused("listOperatorCatalogue"),
    setEnabled: unused("setEnabled"),
    setRules: unused("setRules"),
    clearStoredFlag: unused("clearStoredFlag"),
    isEnabledForCaller: unused("isEnabledForCaller"),
    isEnabledByOrganizationForCaller: unused("isEnabledByOrganizationForCaller"),
    resolveFrontendFlagsForCaller: unused("resolveFrontendFlagsForCaller"),
    listExperimentsForCaller: unused("listExperimentsForCaller"),
    setExperimentEnrolmentForCaller: unused("setExperimentEnrolmentForCaller"),
    setExperimentTenantPolicyForCaller: unused("setExperimentTenantPolicyForCaller"),
  };
}

describe("isVoiceAgentsEnabledForProject", () => {
  describe("given a project", () => {
    describe("when the organizationId is passed", () => {
      it("uses it and never resolves the project", async () => {
        const isEnabledMock = vi.fn<FeatureFlagApi["isEnabled"]>().mockResolvedValue(true);
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
        const isEnabledMock = vi.fn<FeatureFlagApi["isEnabled"]>().mockResolvedValue(true);
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
        const isEnabledMock = vi.fn<FeatureFlagApi["isEnabled"]>().mockResolvedValue(true);
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
        const isEnabledMock = vi.fn<FeatureFlagApi["isEnabled"]>().mockResolvedValue(true);

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
