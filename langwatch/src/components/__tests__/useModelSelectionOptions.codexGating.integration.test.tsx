/**
 * @vitest-environment jsdom
 *
 * Pins the codex gating WIRING inside `useModelSelectionOptions` (the
 * filter logic itself is unit-tested in filterRestrictedModels.unit.test.ts
 * and codexRestrictions.unit.test.ts): with the openai_codex provider row
 * enabled for the project, the hook still drops codex models unless the
 * caller declares a licensed featureKey, the fail-closed default every
 * picker (playground, workflows, evaluators) inherits by not passing one.
 * Langy's composer pill passes `langy.chat` and gets them back.
 *
 * Runs the real hook against a mocked tRPC boundary, matching
 * ModelSelector.displayName.integration.test.tsx's pattern.
 *
 * @see specs/model-providers/codex-account-provider.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: {
            providers: [
              {
                provider: "openai",
                enabled: true,
                customModels: null,
                customEmbeddingsModels: null,
              },
              {
                provider: "openai_codex",
                enabled: true,
                customModels: null,
                customEmbeddingsModels: null,
              },
            ],
          },
          isLoading: false,
        }),
      },
    },
  },
}));

import { useModelSelectionOptions } from "../ModelSelector";

const OPTIONS = ["openai/gpt-5-mini", "openai_codex/gpt-5.6-terra"];

describe("useModelSelectionOptions()", () => {
  describe("given the openai_codex provider is enabled for the project", () => {
    describe("when the caller passes no featureKey", () => {
      it("excludes codex models from the options", () => {
        const { result } = renderHook(() =>
          useModelSelectionOptions(OPTIONS, "openai/gpt-5-mini", "chat"),
        );

        const values = result.current.selectOptions.map((o) => o.value);
        expect(values).toContain("openai/gpt-5-mini");
        expect(values).not.toContain("openai_codex/gpt-5.6-terra");
      });
    });

    describe("when the caller declares the langy.chat featureKey", () => {
      it("includes codex models alongside the unrestricted ones", () => {
        const { result } = renderHook(() =>
          useModelSelectionOptions(
            OPTIONS,
            "openai_codex/gpt-5.6-terra",
            "chat",
            { featureKey: "langy.chat" },
          ),
        );

        const values = result.current.selectOptions.map((o) => o.value);
        expect(values).toContain("openai/gpt-5-mini");
        expect(values).toContain("openai_codex/gpt-5.6-terra");
      });
    });

    describe("when the caller declares a featureKey codex is not licensed for", () => {
      it("excludes codex models from the options", () => {
        const { result } = renderHook(() =>
          useModelSelectionOptions(OPTIONS, "openai/gpt-5-mini", "chat", {
            featureKey: "prompt.create_default",
          }),
        );

        const values = result.current.selectOptions.map((o) => o.value);
        expect(values).not.toContain("openai_codex/gpt-5.6-terra");
      });
    });
  });
});
