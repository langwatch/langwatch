/**
 * @vitest-environment jsdom
 *
 * A suggestion saved from the legacy comment card is also written as the
 * trace's corrected output, so the card has to make the drawer's copy of that
 * correction stale along with the annotation reads. Left cached, the drawer
 * keeps showing the trace as it was before the correction.
 * See specs/traces-v2/trace-edit-overlay.feature and
 * specs/traces-v2/annotations.feature.
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
  invalidateAnnotationFeed: vi.fn(),
  invalidateAnnotationList: vi.fn(),
  invalidateOverlay: vi.fn(),
  annotation: undefined as
    | undefined
    | { id: string; comment: string; scoreOptions: Record<string, unknown> },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
    isPublicRoute: false,
  }),
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { name: "Ada", image: null } } }),
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      annotation: {
        getByTraceId: { invalidate: mocks.invalidateAnnotations },
        getByTraceIds: { invalidate: mocks.invalidateAnnotationFeed },
        getAll: { invalidate: mocks.invalidateAnnotationList },
      },
      traceEditOverlay: {
        getByTraceId: { invalidate: mocks.invalidateOverlay },
      },
    }),
    annotation: {
      getById: {
        useQuery: () => ({ data: mocks.annotation, isLoading: false }),
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

const { AnnotationComment } = await import("../AnnotationComment");
const { useAnnotationCommentStore } = await import(
  "~/hooks/useAnnotationCommentStore"
);

const TRACE = "trace-1";

/** The trace's stored correction, as the invalidation would name it. */
const THIS_TRACES_CORRECTION = { projectId: "project-1", traceId: TRACE };

function renderComment() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AnnotationComment key="" />
    </ChakraProvider>,
  );
}

/** Save the card and let the mutation report success the way the server would. */
async function saveAndSucceed(
  buttonName: string,
  mutation: typeof mocks.create,
) {
  renderComment();
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
  // The card submits through react-hook-form, so the mutation is a tick away.
  await vi.waitUntil(() => mutation.mock.calls.length > 0);
  const options = mutation.mock.calls[0]?.[1] as MutationOptions;
  options.onSuccess?.();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.annotation = undefined;
  useAnnotationCommentStore.setState({
    traceId: TRACE,
    action: "new",
    annotationId: null,
    expectedOutput: "the corrected answer",
  });
});

afterEach(cleanup);

describe("given a reviewer writing a comment that carries a suggestion", () => {
  describe("when the comment is saved", () => {
    /** @scenario "Saving builds on the correction as it stands" */
    it("makes the trace's stored correction stale", async () => {
      await saveAndSucceed("Save", mocks.create);

      expect(mocks.invalidateOverlay).toHaveBeenCalledWith(
        THIS_TRACES_CORRECTION,
      );
    });

    /** @scenario "Saving, updating, or deleting an annotation refreshes the batched annotation feed" */
    it("refreshes the annotation reads the conversation renders from", async () => {
      await saveAndSucceed("Save", mocks.create);

      expect(mocks.invalidateAnnotations).toHaveBeenCalled();
      expect(mocks.invalidateAnnotationFeed).toHaveBeenCalled();
    });
  });
});

describe("given a comment the reviewer is editing", () => {
  beforeEach(() => {
    mocks.annotation = { id: "annotation-1", comment: "", scoreOptions: {} };
    useAnnotationCommentStore.setState({
      action: "edit",
      annotationId: "annotation-1",
    });
  });

  describe("when the edit is saved", () => {
    /** @scenario "Saving builds on the correction as it stands" */
    it("makes the trace's stored correction stale", async () => {
      await saveAndSucceed("Update", mocks.update);

      expect(mocks.invalidateOverlay).toHaveBeenCalledWith(
        THIS_TRACES_CORRECTION,
      );
    });
  });
});
