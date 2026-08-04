/**
 * @vitest-environment jsdom
 *
 * A suggested output is stored as a correction to the trace, so writing one has
 * to make the drawer's copy of that correction stale. Left cached, an edit
 * session started minutes later would build on the old one and undo the
 * suggestion when it saves.
 * See specs/traces-v2/trace-edit-mode.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

type MutationOptions = { onSuccess?: () => void; onError?: () => void };

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  invalidateAnnotations: vi.fn(),
  invalidateOverlay: vi.fn(),
  existingAnnotations: [] as unknown[],
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      annotation: { getByTraceId: { invalidate: mocks.invalidateAnnotations } },
      traceEditOverlay: {
        getByTraceId: { invalidate: mocks.invalidateOverlay },
      },
    }),
    annotation: {
      getByTraceId: {
        useQuery: () => ({ data: mocks.existingAnnotations }),
      },
      create: {
        useMutation: () => ({ mutate: mocks.create, isLoading: false }),
      },
      updateByTraceId: {
        useMutation: () => ({ mutate: mocks.update, isLoading: false }),
      },
      deleteById: {
        useMutation: () => ({ mutate: mocks.remove, isLoading: false }),
      },
    },
    annotationScore: {
      getAllActive: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

const { AnnotationPopover } = await import("../AnnotationPopover");

const TRACE = "trace-1";

function renderSuggest({ annotationId }: { annotationId?: string } = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AnnotationPopover
        traceId={TRACE}
        output="the original answer"
        mode="suggest"
        annotationId={annotationId}
        open
        onOpenChange={vi.fn()}
        trigger={<button type="button">Suggest</button>}
      />
    </ChakraProvider>,
  );
}

/** The trace's stored correction, as the invalidation would name it. */
const THIS_TRACES_CORRECTION = { projectId: "project-1", traceId: TRACE };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existingAnnotations = [];
});

afterEach(cleanup);

describe("given a reviewer suggesting a correction on a trace", () => {
  describe("when the suggestion is saved", () => {
    /** @scenario "Saving builds on the correction as it stands" */
    it("makes the trace's stored correction stale", async () => {
      renderSuggest();

      fireEvent.click(await screen.findByRole("button", { name: "Save" }));
      const options = mocks.create.mock.calls[0]?.[1] as MutationOptions;
      options.onSuccess?.();

      expect(mocks.invalidateAnnotations).toHaveBeenCalled();
      expect(mocks.invalidateOverlay).toHaveBeenCalledWith(
        THIS_TRACES_CORRECTION,
      );
    });
  });
});

describe("given a suggestion the reviewer had already made", () => {
  beforeEach(() => {
    mocks.existingAnnotations = [
      {
        id: "annotation-1",
        comment: "",
        expectedOutput: "an earlier suggestion",
        scoreOptions: {},
      },
    ];
  });

  describe("when it is changed", () => {
    /** @scenario "Saving builds on the correction as it stands" */
    it("makes the trace's stored correction stale", async () => {
      renderSuggest({ annotationId: "annotation-1" });

      fireEvent.click(await screen.findByRole("button", { name: "Update" }));
      const options = mocks.update.mock.calls[0]?.[1] as MutationOptions;
      options.onSuccess?.();

      expect(mocks.invalidateAnnotations).toHaveBeenCalled();
      expect(mocks.invalidateOverlay).toHaveBeenCalledWith(
        THIS_TRACES_CORRECTION,
      );
    });
  });

  describe("when it is deleted", () => {
    /** @scenario "Saving builds on the correction as it stands" */
    it("makes the trace's stored correction stale", async () => {
      renderSuggest({ annotationId: "annotation-1" });

      fireEvent.click(
        await screen.findByRole("button", { name: "Delete annotation" }),
      );
      const options = mocks.remove.mock.calls[0]?.[1] as MutationOptions;
      options.onSuccess?.();

      expect(mocks.invalidateAnnotations).toHaveBeenCalled();
      expect(mocks.invalidateOverlay).toHaveBeenCalledWith(
        THIS_TRACES_CORRECTION,
      );
    });
  });
});
