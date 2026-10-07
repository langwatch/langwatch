// @vitest-environment jsdom
/**
 * A refused annotation write shows the copy registered for the refusal's
 * code, the same way every other write does, so an annotation on an
 * aggregate project (ADR-144 decision 8) reads "Data can't be added to this
 * project" instead of a generic failure.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("~/hooks/useAnnotationInvalidation", () => ({
  useAnnotationInvalidation: () => vi.fn(),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: mocks.toast },
}));

vi.mock("~/utils/api", () => ({
  api: {
    annotation: {
      getByTraceId: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutate: mocks.create }) },
      updateByTraceId: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteById: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    annotationScore: {
      getAllActive: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

import { useAnnotationMutations } from "../useAnnotationForm";

/** A tRPC client error carrying a handled payload, as the wire delivers it. */
function trpcRefusal(code: string) {
  return {
    message: code,
    data: { error: { code, httpStatus: 403, fault: "customer", meta: {} } },
  };
}

function saveAndFailWith(error: unknown) {
  const { result } = renderHook(() =>
    useAnnotationMutations({
      traceId: "trace-1",
      mode: "comment",
      enabled: true,
      onDone: vi.fn(),
    }),
  );
  result.current.save({
    comment: "looks wrong",
    scoreOptions: {},
    expectedOutput: "",
  });
  const options = mocks.create.mock.calls[0]?.[1] as {
    onError: (error: unknown) => void;
  };
  options.onError(error);
  return mocks.toast.mock.calls.at(-1)?.[0] as { title: string };
}

describe("useAnnotationMutations", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.toast.mockReset();
  });

  describe("when the server refuses the save as read only", () => {
    /** @scenario "A refused annotation on the aggregate says why" */
    it("shows the registered read-only copy", () => {
      const toast = saveAndFailWith(
        trpcRefusal("aggregate_project_is_read_only"),
      );

      expect(toast.title).toBe("Data can't be added to this project");
    });
  });

  describe("when the save fails for a reason the server cannot name", () => {
    it("keeps the annotation's own title", () => {
      const toast = saveAndFailWith(new Error("socket hang up"));

      expect(toast.title).toBe("Could not save annotation");
    });
  });
});
