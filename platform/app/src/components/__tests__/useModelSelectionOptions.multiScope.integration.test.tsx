/**
 * @vitest-environment jsdom
 *
 * `listAllForProjectForFrontend` returns ONE ROW PER PROVIDER AND SCOPE, so a
 * provider configured at both the project and the organization arrives twice.
 * The hook folds those rows into one provider config, and a custom model
 * declared at both scopes must survive that fold once: `getCustomModels` turns
 * every list entry into an option without looking for repeats, so a
 * concatenation put the same model in the picker twice — two identical rows,
 * and two React children with the same key.
 *
 * @see specs/model-providers/role-based-default-models.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("~/utils/api", () => {
  const response = {
    data: {
      providers: [
        {
          provider: "custom",
          enabled: true,
          customModels: [{ modelId: "stealth/ox-alpha" }],
          customEmbeddingsModels: null,
        },
        // The same provider again, from a wider scope, carrying the same model
        // plus one of its own.
        {
          provider: "custom",
          enabled: true,
          customModels: [
            { modelId: "stealth/ox-alpha" },
            { modelId: "stealth/ox-beta" },
          ],
          customEmbeddingsModels: null,
        },
      ],
    },
    isLoading: false,
  };
  return {
    api: {
      modelProvider: {
        listAllForProjectForFrontend: { useQuery: () => response },
      },
    },
  };
});

import { useModelSelectionOptions } from "../ModelSelector";

describe("useModelSelectionOptions()", () => {
  describe("when one provider is configured at two scopes", () => {
    it("offers a model declared at both of them exactly once", () => {
      const { result } = renderHook(() =>
        useModelSelectionOptions([], "custom/stealth/ox-alpha", "chat"),
      );

      expect(
        result.current.selectOptions.map((option) => option.value),
      ).toEqual(["custom/stealth/ox-alpha", "custom/stealth/ox-beta"]);
    });
  });
});
