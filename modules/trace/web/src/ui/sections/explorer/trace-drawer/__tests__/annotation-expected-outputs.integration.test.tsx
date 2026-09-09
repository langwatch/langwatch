/**
 * @vitest-environment jsdom
 *
 * Saved suggestions read as a list under the message output, and editing one
 * happens in the correction popover rather than in a textarea whose only save
 * button lived in another column.
 *
 * Spec: specs/traces-v2/annotations.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  annotations: [] as {
    id: string;
    expectedOutput: string | null;
    user: { name: string; image: string | null } | null;
    anchorKind?: string | null;
    anchorId?: string | null;
    anchorPath?: string | null;
  }[],
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1", slug: "acme" } }),
}));

vi.mock("../../../../../behavior/trace-api.ts", () => ({
  api: {
    annotation: {
      getByTraceId: { useQuery: () => ({ data: mocks.annotations, isLoading: false }) },
    },
  },
}));

vi.mock("@langwatch/design-system/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Stands in for the popover, cloning the trigger it was handed the way
// Popover.Trigger's asChild does, so the test sees the element Zag would
// anchor on and hand focus back to.
vi.mock("../conversation-view/annotation-popover.tsx", async () => {
  const { cloneElement } = await import("react");
  return {
    AnnotationPopover: (props: {
      open: boolean;
      mode: string;
      traceId: string;
      annotationId?: string;
      trigger: React.ReactElement;
      onOpenChange: (open: boolean) => void;
    }) => (
      <>
        {cloneElement(props.trigger, {
          "data-testid": "popover-trigger",
          onClick: () => props.onOpenChange(true),
        } as Record<string, unknown>)}
        {props.open ? (
          <div
            data-testid="correction-popover"
            data-mode={props.mode}
            data-trace-id={props.traceId}
            data-annotation-id={props.annotationId ?? ""}
          />
        ) : null}
      </>
    ),
  };
});

const { AnnotationExpectedOutputs } = await import("../annotation-expected-outputs.tsx");

const renderOutputs = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AnnotationExpectedOutputs traceId="trace-1" output="the raw output" />
    </ChakraProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.annotations = [
    {
      id: "annotation-1",
      expectedOutput: "the corrected answer",
      user: { name: "Reviewer One", image: null },
    },
    {
      id: "annotation-2",
      expectedOutput: "another corrected answer",
      user: { name: "Reviewer Two", image: null },
    },
  ];
});

afterEach(() => {
  cleanup();
});

describe("given a trace that already carries suggestions", () => {
  describe("when the suggestions render under the output", () => {
    /** @scenario "Saved suggestions are listed under the output without an editor" */
    it("lists every suggestion and offers no editable field", () => {
      renderOutputs();

      expect(screen.getByText("the corrected answer")).toBeTruthy();
      expect(screen.getByText("another corrected answer")).toBeTruthy();
      expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    });
  });

  describe("when the popover is anchored", () => {
    it("hangs each popover off the suggestion it belongs to", () => {
      renderOutputs();

      const triggers = screen.getAllByTestId("popover-trigger");

      expect(triggers).toHaveLength(2);
      for (const trigger of triggers) {
        // A hidden anchor would leave the keyboard nowhere to go on close.
        expect(trigger.tagName).toBe("BUTTON");
        expect(trigger.getAttribute("aria-hidden")).toBeNull();
      }
    });
  });

  describe("when the reviewer picks a saved suggestion", () => {
    /** @scenario "Picking a saved suggestion reopens it in the correction popover" */
    it("reopens that suggestion in the correction popover", async () => {
      const user = userEvent.setup();
      renderOutputs();

      await user.click(screen.getByRole("button", { name: /the corrected answer/ }));

      const popover = screen.getByTestId("correction-popover");
      expect(popover.getAttribute("data-mode")).toBe("suggest");
      expect(popover.getAttribute("data-annotation-id")).toBe("annotation-1");
      expect(popover.getAttribute("data-trace-id")).toBe("trace-1");
    });
  });
});

describe("given suggestions that correct something other than the output", () => {
  describe("when the suggestions render under the output", () => {
    it("lists only the ones suggesting what this output should have been", () => {
      mocks.annotations = [
        {
          id: "annotation-1",
          expectedOutput: "the corrected answer",
          user: { name: "Reviewer One", image: null },
          anchorKind: "field",
          anchorId: "trace-1",
          anchorPath: "output",
        },
        {
          id: "annotation-2",
          expectedOutput: "what the user meant to ask",
          user: { name: "Reviewer Two", image: null },
          anchorKind: "field",
          anchorId: "trace-1",
          anchorPath: "input",
        },
        {
          id: "annotation-3",
          expectedOutput: "Amsterdam",
          user: { name: "Reviewer Three", image: null },
          anchorKind: "field",
          anchorId: "span-search",
          anchorPath: "output",
        },
      ];
      renderOutputs();

      expect(screen.getByText("the corrected answer")).toBeTruthy();
      expect(screen.queryByText("what the user meant to ask")).toBeNull();
      expect(screen.queryByText("Amsterdam")).toBeNull();
    });
  });
});

describe("given a trace with no suggestions", () => {
  describe("when the message renders", () => {
    it("shows nothing at all", () => {
      mocks.annotations = [];
      const { container } = renderOutputs();

      expect(container.innerHTML).toBe("");
    });
  });
});
