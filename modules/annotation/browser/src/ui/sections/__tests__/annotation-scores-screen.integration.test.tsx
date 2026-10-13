/**
 * @vitest-environment jsdom
 * Pins the score settings screen's wait for its project before it asks for scores.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AnnotationScoresHostApi,
  AnnotationScoresHostProvider,
  type AnnotationScoresProject,
} from "../../../model/annotation-scores-host.ts";
import AnnotationScoresScreen from "../annotation-scores-screen.tsx";

const mocks = vi.hoisted(() => ({ refetch: vi.fn(async () => void 0) }));

vi.mock("../../../behavior/annotation-scores-api.ts", () => ({
  annotationScoresApi: {
    annotationScore: {
      getAll: {
        useQuery: () => ({ data: undefined, isLoading: false, refetch: mocks.refetch }),
      },
      toggle: { useMutation: () => ({ mutate: () => void 0 }) },
      delete: { useMutation: () => ({ mutate: () => void 0 }) },
    },
  },
}));

class StubScoresHost extends AnnotationScoresHostApi {
  constructor(private readonly currentProject: AnnotationScoresProject | undefined) {
    super();
  }

  project() {
    return this.currentProject;
  }

  isLiteMember() {
    return true;
  }

  editor() {
    return { open: false };
  }

  openEditor() {}

  closeEditor() {}

  succeeded() {}

  failed() {}
}

function renderScreen(project: AnnotationScoresProject | undefined) {
  return renderWithDesignSystem(
    <AnnotationScoresHostProvider value={new StubScoresHost(project)}>
      <AnnotationScoresScreen />
    </AnnotationScoresHostProvider>,
  );
}

beforeEach(() => mocks.refetch.mockClear());

afterEach(() => cleanup());

describe("given the project has not resolved", () => {
  /** @scenario "the score settings screen asks for scores only once a project resolves" */
  it("requests no score list", () => {
    renderScreen(void 0);

    expect(mocks.refetch).not.toHaveBeenCalled();
  });
});

describe("given the project has resolved", () => {
  /** @scenario "the score settings screen asks for scores only once a project resolves" */
  it("requests the score list", () => {
    renderScreen({ id: "proj-1" });

    expect(mocks.refetch).toHaveBeenCalled();
  });
});
