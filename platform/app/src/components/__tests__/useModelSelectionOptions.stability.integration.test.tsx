/**
 * @vitest-environment jsdom
 *
 * Pins the referential stability of `useModelSelectionOptions`: a re-render of
 * the caller with the same inputs returns the SAME `selectOptions` and
 * `groupedByProvider` references. The hook used to rebuild both arrays on
 * every render, which defeated every downstream `useMemo` keyed on them — the
 * langy composer's model pill rebuilt its whole combobox collection each time
 * its parent rendered, and every other picker paid the same tax.
 *
 * Runs the real hook against a mocked tRPC boundary, matching
 * useModelSelectionOptions.codexGating.integration.test.tsx's pattern.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

// One frozen response object: tanstack-query's structural sharing hands the
// SAME `data` reference back across renders while the server state is
// unchanged, and the hook's stability contract builds on that.
vi.mock("~/utils/api", () => {
  const response = {
    data: [
      {
        provider: "openai",
        enabled: true,
        customModels: null,
        customEmbeddingsModels: null,
      },
      {
        provider: "custom",
        enabled: true,
        customModels: [{ modelId: "stealth/ox-alpha" }],
        customEmbeddingsModels: null,
      },
    ],
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

const OPTIONS = ["openai/gpt-5-mini"];

describe("useModelSelectionOptions()", () => {
  describe("when the caller re-renders with the same inputs", () => {
    it("returns the same option list references", () => {
      const { result, rerender } = renderHook(() =>
        useModelSelectionOptions(OPTIONS, "openai/gpt-5-mini", "chat"),
      );

      const first = result.current;
      expect(first.selectOptions.map((o) => o.value)).toEqual([
        "custom/stealth/ox-alpha",
        "openai/gpt-5-mini",
      ]);

      rerender();

      expect(result.current.selectOptions).toBe(first.selectOptions);
      expect(result.current.groupedByProvider).toBe(first.groupedByProvider);
    });
  });
});
