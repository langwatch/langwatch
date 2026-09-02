/**
 * @vitest-environment jsdom
 *
 * A suggested output is stored as a correction to the trace, so writing one has
 * to make the drawer's copy of that correction stale. Left cached, an edit
 * session started minutes later would build on the old one and undo the
 * suggestion when it saves. The same write also has to refresh the batched
 * annotation feed the conversation counts its turns from.
 * See specs/traces-v2/trace-edit-mode.feature and
 * specs/traces-v2/annotations.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

type MutationOptions = { onSuccess?: () => void; onError?: () => void };

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  invalidateAnnotations: vi.fn(),
  invalidateAnnotationFeed: vi.fn(),
  invalidateOverlay: vi.fn(),
  existingAnnotations: [] as unknown[],
}));

vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("../../../../../components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("../../../../../behavior/trace-api", () => ({
  api: {
    useUtils: () => ({
      annotation: {
        getByTraceId: { invalidate: mocks.invalidateAnnotations },
        getByTraceIds: { invalidate: mocks.invalidateAnnotationFeed },
      },
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
const { useAnnotationMutations } = await import("../useAnnotationForm");

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

/**
 * Run the popover's save path to completion: render, submit, and let the
 * mutation report success the way the server would.
 */
async function submitAndSucceed({
  buttonName,
  mutation,
  annotationId,
}: {
  buttonName: string;
  mutation: Mock;
  annotationId?: string;
}) {
  renderSuggest({ annotationId });
  fireEvent.click(await screen.findByRole("button", { name: buttonName }));
  const options = mutation.mock.calls[0]?.[1] as MutationOptions;
  options.onSuccess?.();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existingAnnotations = [];
});

afterEach(cleanup);

describe("given a reviewer suggesting a correction on a trace", () => {
  describe("when the suggestion is saved", () => {
    /** @scenario "Saving builds on the correction as it stands" */
    it("makes the trace's stored correction stale", async () => {
      await submitAndSucceed({ buttonName: "Save", mutation: mocks.create });

      expect(mocks.invalidateAnnotations).toHaveBeenCalled();
      expect(mocks.invalidateOverlay).toHaveBeenCalledWith(THIS_TRACES_CORRECTION);
    });

    /** @scenario "Saving, updating, or deleting an annotation refreshes the batched annotation feed" */
    it("refreshes the batched annotation feed the conversation counts from", async () => {
      await submitAndSucceed({ buttonName: "Save", mutation: mocks.create });

      expect(mocks.invalidateAnnotationFeed).toHaveBeenCalled();
    });
  });
});

describe("given an annotation opened for editing before its read settles", () => {
  // `existingAnnotations` stays empty, which is what the read looks like
  // while it is still in flight.

  /** @scenario "Saving an edit before the annotation is read writes nothing" */
  it("writes nothing rather than creating a second annotation", () => {
    const { result } = renderHook(() =>
      useAnnotationMutations({
        traceId: TRACE,
        mode: "suggest",
        annotationId: "annotation-1",
        enabled: true,
        onDone: vi.fn(),
      }),
    );

    result.current.save({
      comment: "",
      expectedOutput: "a correction",
      scoreOptions: {},
    });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(result.current.isSaveBlocked).toBe(true);
  });

  /** @scenario "Saving an edit before the annotation is read writes nothing" */
  it("says so on the save control", async () => {
    renderSuggest({ annotationId: "annotation-1" });

    expect(await screen.findByRole("button", { name: "Update" })).toBeDisabled();
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
      await submitAndSucceed({
        buttonName: "Update",
        mutation: mocks.update,
        annotationId: "annotation-1",
      });

      expect(mocks.invalidateAnnotations).toHaveBeenCalled();
      expect(mocks.invalidateOverlay).toHaveBeenCalledWith(THIS_TRACES_CORRECTION);
    });

    /** @scenario "Saving, updating, or deleting an annotation refreshes the batched annotation feed" */
    it("refreshes the batched annotation feed the conversation counts from", async () => {
      await submitAndSucceed({
        buttonName: "Update",
        mutation: mocks.update,
        annotationId: "annotation-1",
      });

      expect(mocks.invalidateAnnotationFeed).toHaveBeenCalled();
    });
  });

  describe("when it is deleted", () => {
    /** @scenario "Saving builds on the correction as it stands" */
    it("makes the trace's stored correction stale", async () => {
      await submitAndSucceed({
        buttonName: "Delete annotation",
        mutation: mocks.remove,
        annotationId: "annotation-1",
      });

      expect(mocks.invalidateAnnotations).toHaveBeenCalled();
      expect(mocks.invalidateOverlay).toHaveBeenCalledWith(THIS_TRACES_CORRECTION);
    });

    /** @scenario "Saving, updating, or deleting an annotation refreshes the batched annotation feed" */
    it("refreshes the batched annotation feed the conversation counts from", async () => {
      await submitAndSucceed({
        buttonName: "Delete annotation",
        mutation: mocks.remove,
        annotationId: "annotation-1",
      });

      expect(mocks.invalidateAnnotationFeed).toHaveBeenCalled();
    });
  });
});
