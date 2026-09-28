/**
 * @vitest-environment jsdom
 * @see specs/features/onboarding/guided-welcome-takeover.feature
 */
import { guidedProvidersFor } from "@langwatch/onboarding-browser-kit";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const assignRole = vi.fn().mockResolvedValue({});
const recordProvider = vi.fn().mockResolvedValue({});

vi.mock("../../../../behavior/onboarding-api.ts", () => {
  const mutation = (mutateAsync: (input: unknown) => unknown) => ({
    useMutation: () => ({ mutateAsync, isPending: false }),
  });
  return {
    onboardingApi: {
      onboarding: {
        recordProvider: mutation((input) => recordProvider(input)),
        recordProviderSkipped: mutation(vi.fn()),
      },
      modelProvider: {
        setRoleAssignmentForScope: mutation((input) => assignRole(input)),
        getAllForProjectForFrontend: {
          useQuery: () => ({
            refetch: () => Promise.resolve({ data: { openai: { models: ["stored-first"] } } }),
          }),
        },
      },
    },
  };
});

import { useGuidedProviderConnect } from "../use-guided-provider-connect.ts";

describe("given the shared form saved OpenAI with the recommended model kept", () => {
  describe("when the guided step finishes the connection", () => {
    /** @scenario "A connected provider is saved at the organization and becomes Langy's model" */
    it("points Langy at the picked model and records the provider and model", async () => {
      const onConnected = vi.fn();
      const openai = guidedProvidersFor().find((provider) => provider.registryKey === "openai");
      const { result } = renderHook(() =>
        useGuidedProviderConnect({ organizationId: "org_1", projectId: "project_1", onConnected }),
      );

      await result.current.onSaved(openai!, { chatModel: "gpt-picked" });

      expect(assignRole).toHaveBeenCalledWith({
        scopeType: "ORGANIZATION",
        scopeId: "org_1",
        role: "LANGY",
        model: "openai/gpt-picked",
      });
      expect(recordProvider).toHaveBeenCalledWith({
        organizationId: "org_1",
        provider: "openai",
        model: "gpt-picked",
      });
      expect(onConnected).toHaveBeenCalledWith({ provider: "openai", model: "gpt-picked" });
    });
  });
});
