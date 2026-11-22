/**
 * @see specs/experiments-v3/experiment-replicate.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useEvaluationsV3Store } from "../use-evaluations-v3-store.ts";

describe("given an editor opened on an experiment row", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.setState({
      experimentId: "copy-id",
      experimentSlug: "copy-slug",
    });
  });

  describe("when a saved state carrying another experiment's id and slug is loaded", () => {
    /** @scenario "Loading a copy made before the fix keeps the loaded row's identity" */
    it("keeps the row's id and slug", () => {
      useEvaluationsV3Store.getState().loadState({
        experimentId: "orig-id",
        experimentSlug: "orig-slug",
        name: "X",
        datasets: [],
        activeDatasetId: "",
        evaluators: [],
        targets: [],
      });

      const state = useEvaluationsV3Store.getState();
      expect(state.experimentId).toBe("copy-id");
      expect(state.experimentSlug).toBe("copy-slug");
      expect(state.name).toBe("X");
    });
  });
});
