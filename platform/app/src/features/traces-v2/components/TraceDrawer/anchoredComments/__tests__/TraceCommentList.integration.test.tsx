/**
 * @vitest-environment jsdom
 *
 * The trace's whole comment list: what each comment says it is about, and what
 * a comment reads as once the part it was left on is gone.
 * See specs/traces-v2/anchored-comments.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1" },
    hasPermission: () => true,
  }),
}));

import { useDrawerStore } from "../../../../stores/drawerStore";
import { useFocusSectionStore } from "../../../../stores/focusSectionStore";
import { TraceCommentList } from "../TraceCommentList";

const TRACE_ID = "trace-1";
const SEARCH_SPAN = "span-7";
const GONE_SPAN = "span-gone";

function comment(over: Partial<AnnotationByTrace>): AnnotationByTrace {
  return {
    id: "annotation-1",
    traceId: TRACE_ID,
    comment: "",
    email: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    expectedOutput: null,
    isThumbsUp: null,
    scoreOptions: {},
    user: { id: "user-2", name: "Ada", image: null },
    anchorKind: null,
    anchorId: null,
    anchorPath: null,
    ...over,
  } as unknown as AnnotationByTrace;
}

const onTheSpan = comment({
  id: "annotation-on-span",
  comment: "this search returned nothing",
  anchorKind: "span",
  anchorId: SEARCH_SPAN,
});
const onAnAttribute = comment({
  id: "annotation-on-attribute",
  comment: "wrong model pinned",
  anchorKind: "field",
  anchorId: SEARCH_SPAN,
  anchorPath: "params.gen_ai.request.model",
});
const onTheTrace = comment({
  id: "annotation-on-trace",
  comment: "the answer contradicts the policy",
});
const onADeletedSpan = comment({
  id: "annotation-on-deleted-span",
  comment: "this step should not have run",
  anchorKind: "span",
  anchorId: GONE_SPAN,
});

function renderList(comments: AnnotationByTrace[]) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TraceCommentList
        traceId={TRACE_ID}
        comments={comments}
        spanNames={new Map([[SEARCH_SPAN, "web_search"]])}
        resolvable={new Set([TRACE_ID, SEARCH_SPAN])}
      />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  useDrawerStore.getState().clearSpan();
  useFocusSectionStore.getState().clear();
});

afterEach(cleanup);

describe("given comments on a span, on an attribute and on the trace itself", () => {
  const comments = [onTheSpan, onAnAttribute, onTheTrace];

  /** @scenario "The trace's whole comment list names what each comment is about" */
  it("lists each comment with the part of the trace it is about", () => {
    renderList(comments);

    expect(
      screen.getByRole("button", { name: "Go to Span web_search" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Go to Span web_search · Parameters · gen_ai.request.model",
      }),
    ).toBeInTheDocument();
  });

  /** @scenario "The trace's whole comment list names what each comment is about" */
  it("lists the one about the trace itself without a part", () => {
    renderList(comments);

    expect(
      screen.getByText("the answer contradicts the policy"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("takes the reader to the span a comment is about", () => {
    renderList(comments);

    fireEvent.click(
      screen.getByRole("button", { name: "Go to Span web_search" }),
    );

    expect(useDrawerStore.getState().selectedSpanId).toBe(SEARCH_SPAN);
    expect(useDrawerStore.getState().viewMode).toBe("trace");
  });

  it("opens the section holding an attribute a comment is about", () => {
    renderList(comments);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Go to Span web_search · Parameters · gen_ai.request.model",
      }),
    );

    expect(useFocusSectionStore.getState().pending).toMatchObject({
      traceId: TRACE_ID,
      section: "attributes",
    });
  });
});

describe("given a comment on a span a correction deleted", () => {
  /** @scenario "A comment on a span a correction deleted reads as being on a part that is no longer there" */
  it("still lists the comment", () => {
    renderList([onADeletedSpan]);

    expect(
      screen.getByText("this step should not have run"),
    ).toBeInTheDocument();
  });

  /** @scenario "A comment on a span a correction deleted reads as being on a part that is no longer there" */
  it("reads as being about a part of the trace that is no longer there", () => {
    renderList([onADeletedSpan]);

    expect(
      screen.getByText("On a part of the trace that is no longer there"),
    ).toBeInTheDocument();
  });

  /** @scenario "A comment whose anchor is gone offers nowhere to jump to" */
  it("offers no jump", () => {
    renderList([onADeletedSpan]);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
