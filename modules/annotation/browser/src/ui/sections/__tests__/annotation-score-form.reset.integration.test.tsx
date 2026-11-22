/**
 * @vitest-environment jsdom
 * Pins that an edited score's typed fields survive the form's reset to the loaded score.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AnnotationScoresHostApi,
  AnnotationScoresHostProvider,
  type AnnotationScoresProject,
} from "../../../model/annotation-scores-host.ts";
import { AnnotationScoreForm } from "../annotation-score-form.tsx";

const mocks = vi.hoisted(() => ({
  saved: vi.fn(),
  score: undefined as unknown,
}));

vi.mock("../../../behavior/annotation-scores-api.ts", () => ({
  annotationScoresApi: {
    useUtils: () => ({
      annotationScore: {
        getAllActive: { invalidate: () => void 0 },
        getAll: { invalidate: () => void 0 },
        getById: { invalidate: () => void 0 },
      },
    }),
    annotationScore: {
      getById: {
        useQuery: () => ({ data: mocks.score, isLoading: !mocks.score }),
      },
      upsert: {
        useMutation: () => ({ isPending: false, mutate: mocks.saved }),
      },
    },
  },
}));

class StubScoresHost extends AnnotationScoresHostApi {
  project(): AnnotationScoresProject {
    return { id: "proj_1" };
  }
  isLiteMember() {
    return false;
  }
  editor() {
    return { open: true };
  }
  openEditor() {}
  closeEditor() {}
  succeeded() {}
  failed() {}
}

const form = () => (
  <AnnotationScoresHostProvider value={new StubScoresHost()}>
    <AnnotationScoreForm annotationScoreId="score_1" onClose={() => void 0} />
  </AnnotationScoresHostProvider>
);

describe("given the score form opened on an existing score", () => {
  describe("when the score loads and its name is edited", () => {
    /** @scenario "An edited annotation score's typed name is the one saved" */
    it("shows the loaded name and saves the typed one", async () => {
      const view = renderWithDesignSystem(form());
      mocks.score = {
        name: "Helpfulness",
        dataType: "OPTION",
        description: "How helpful",
        options: [{ value: "good" }],
      };
      view.rerender(form());

      const name = await screen.findByDisplayValue("Helpfulness");
      fireEvent.change(name, { target: { value: "Usefulness" } });
      fireEvent.click(screen.getByRole("button", { name: "Update Score Metric" }));

      await waitFor(() => expect(mocks.saved).toHaveBeenCalled());
      expect(mocks.saved.mock.calls[0]?.[0]).toMatchObject({
        name: "Usefulness",
        description: "How helpful",
      });
    });
  });
});
