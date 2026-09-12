/**
 * @vitest-environment jsdom
 *
 * `useVoiceAgentsEnabled` is the one read every voice surface shares — it
 * must never flash a voice control on before the flag resolves, and it must
 * hand `useFeatureFlag` the project/organization ids the same way every
 * time so a targeting rule matches consistently.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_TARGETED } from "@langwatch/feature-flag-contract";
import { VOICE_AGENTS_FLAG_KEY } from "@langwatch/feature-flag-contract";
import { useVoiceAgentsEnabled } from "../useVoiceAgentsEnabled";

const state = vi.hoisted(() => ({
  project: undefined as { id: string } | undefined,
  organization: undefined as { id: string } | undefined,
  enabled: false,
  isLoading: false,
}));

const useFeatureFlagMock = vi.hoisted(() => vi.fn());

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: state.project,
    organization: state.organization,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: useFeatureFlagMock,
}));

describe("useVoiceAgentsEnabled", () => {
  beforeEach(() => {
    state.project = { id: "project_1" };
    state.organization = { id: "organization_1" };
    state.enabled = false;
    state.isLoading = false;
    useFeatureFlagMock.mockReset();
    useFeatureFlagMock.mockImplementation(() => ({
      enabled: state.enabled,
      isLoading: state.isLoading,
    }));
  });

  describe("given the flag read is loading", () => {
    it("returns false even when enabled is already true", () => {
      state.enabled = true;
      state.isLoading = true;

      const { result } = renderHook(() => useVoiceAgentsEnabled());

      expect(result.current).toBe(false);
    });
  });

  describe("given the flag read has loaded", () => {
    it("returns true when enabled", () => {
      state.enabled = true;
      state.isLoading = false;

      const { result } = renderHook(() => useVoiceAgentsEnabled());

      expect(result.current).toBe(true);
    });
  });

  describe("given a project and organization are known", () => {
    it("passes projectId and organizationId to useFeatureFlag", () => {
      renderHook(() => useVoiceAgentsEnabled());

      expect(useFeatureFlagMock).toHaveBeenCalledWith(
        VOICE_AGENTS_FLAG_KEY,
        expect.objectContaining({
          projectId: "project_1",
          organizationId: "organization_1",
          enabled: true,
        }),
      );
    });
  });

  describe("given there is no project", () => {
    it("passes NOT_TARGETED as the projectId", () => {
      state.project = undefined;

      renderHook(() => useVoiceAgentsEnabled());

      expect(useFeatureFlagMock).toHaveBeenCalledWith(
        VOICE_AGENTS_FLAG_KEY,
        expect.objectContaining({ projectId: NOT_TARGETED }),
      );
    });
  });

  describe("given there is no organization", () => {
    it("disables the flag read", () => {
      state.organization = undefined;

      renderHook(() => useVoiceAgentsEnabled());

      expect(useFeatureFlagMock).toHaveBeenCalledWith(
        VOICE_AGENTS_FLAG_KEY,
        expect.objectContaining({
          organizationId: undefined,
          enabled: false,
        }),
      );
    });
  });
});
