/**
 * @vitest-environment jsdom
 *
 * Commenting on one attribute row: what the comment is recorded against, what
 * the composer offers on it, and the rows that offer no comment at all.
 * See specs/traces-v2/anchored-comments.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import type { RestrictedAttribute } from "@langwatch/trace-contract";

const mocks = vi.hoisted(() => ({
  canManage: true,
  create: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1" },
    hasPermission: (permission: string) =>
      permission === "annotations:manage" ? mocks.canManage : true,
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("~/components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: {},
  }),
}));

vi.mock("~/components/me/PersonalFeatureGateDialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      annotation: {
        getByTraceId: { invalidate: vi.fn() },
        getByTraceIds: { invalidate: vi.fn() },
      },
      traceEditOverlay: { getByTraceId: { invalidate: vi.fn() } },
    }),
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

import {
  type AttributeComments,
  type AttributeEditing,
  AttributeTable,
} from "../AttributeTable";

const TRACE_ID = "trace-1";
const SPAN_ID = "span-7";
const MODEL_KEY = "gen_ai.request.model";

const CAPTURED = {
  "gen_ai.request.model": "gpt-5-mini",
  "gen_ai.request.temperature": 0.2,
};

const RESTRICTED: RestrictedAttribute[] = [
  {
    pattern: "gen_ai.request.temperature",
    visibleTo: "Admins",
    canSee: false,
  } as unknown as RestrictedAttribute,
];

function comment(over: Partial<AnnotationByTrace> = {}): AnnotationByTrace {
  return {
    id: "annotation-1",
    traceId: TRACE_ID,
    comment: "this model was not the one we pinned",
    email: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    expectedOutput: null,
    isThumbsUp: null,
    scoreOptions: {},
    user: { id: "user-2", name: "Ada", image: null },
    anchorKind: "field",
    anchorId: SPAN_ID,
    anchorPath: `params.${MODEL_KEY}`,
    ...over,
  } as unknown as AnnotationByTrace;
}

function renderTable({
  stored = [] as AnnotationByTrace[],
  editing,
  restrictedAttributes,
}: {
  stored?: AnnotationByTrace[];
  editing?: AttributeEditing;
  restrictedAttributes?: RestrictedAttribute[];
} = {}) {
  const comments: AttributeComments = {
    traceId: TRACE_ID,
    anchorId: SPAN_ID,
    pathPrefix: "params",
    commentsFor: (anchorPath) => stored.filter((a) => a.anchorPath === anchorPath),
  };
  return render(
    <ChakraProvider value={defaultSystem}>
      <AttributeTable
        attributes={CAPTURED}
        restrictedAttributes={restrictedAttributes}
        editing={editing}
        comments={comments}
      />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mocks.canManage = true;
  mocks.create.mockClear();
});

afterEach(cleanup);

describe("given a span with attributes", () => {
  /** @scenario "A comment action with no room for a label names the row it acts on" */
  it("names the attribute in the action that has no room for a label", () => {
    const { container } = renderTable();

    expect(
      container.querySelector(`[aria-label="Comment on ${MODEL_KEY}"]`),
    ).toBeInTheDocument();
  });

  describe("when the reviewer comments on one attribute row", () => {
    /** @scenario "Commenting on an attribute row records that attribute" */
    it("records the comment as being about that attribute", async () => {
      renderTable();

      fireEvent.click(screen.getByRole("button", { name: `Comment on ${MODEL_KEY}` }));
      fireEvent.change(await screen.findByPlaceholderText("Optional"), {
        target: { value: "this model was not the one we pinned" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: TRACE_ID,
          anchorKind: "field",
          anchorId: SPAN_ID,
          anchorPath: `params.${MODEL_KEY}`,
        }),
        expect.anything(),
      );
    });

    /** @scenario "A comment on an attribute row offers no suggestion" */
    it("offers no correction to go with the comment", async () => {
      renderTable();

      fireEvent.click(screen.getByRole("button", { name: `Comment on ${MODEL_KEY}` }));
      await screen.findByPlaceholderText("Optional");

      expect(
        screen.queryByPlaceholderText("What should the output have been?"),
      ).not.toBeInTheDocument();
    });
  });

  /** @scenario "Commenting on an attribute row records that attribute" */
  it("offers no comment action on a row open for correction", () => {
    const { container } = renderTable({
      editing: {
        edits: {},
        onEditAttribute: vi.fn(),
        onResetAttribute: vi.fn(),
      },
    });

    expect(
      container.querySelector(`[aria-label="Comment on ${MODEL_KEY}"]`),
    ).not.toBeInTheDocument();
  });
});

describe("given an attribute the reader is not allowed to read", () => {
  /** @scenario "A field hidden from the reader carries no comment action" */
  it("carries no comment action", () => {
    const { container } = renderTable({ restrictedAttributes: RESTRICTED });

    expect(
      container.querySelector('[aria-label="Comment on gen_ai.request.temperature"]'),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(`[aria-label="Comment on ${MODEL_KEY}"]`),
    ).toBeInTheDocument();
  });
});

describe("given an attribute that already carries a comment", () => {
  /** @scenario "Comments are readable without starting to annotate" */
  it("reads the count on the row", () => {
    renderTable({ stored: [comment()] });

    expect(
      screen.getByRole("button", { name: `1 comment on ${MODEL_KEY}` }),
    ).toBeInTheDocument();
  });
});
