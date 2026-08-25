/**
 * @vitest-environment jsdom
 *
 * The badge on a turn that already carries annotations, and the way from that
 * list into editing one. The line the reviewer picks is the control: it is the
 * popover's anchor, it answers the keyboard, and a reviewer who may not edit
 * annotations is offered no control at all.
 * See specs/traces-v2/annotations.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  canManage: true,
  annotationsForTrace: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
    hasPermission: (permission: string) =>
      permission === "annotations:manage" ? mocks.canManage : true,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    annotation: {
      getByTraceId: { useQuery: mocks.annotationsForTrace },
    },
  },
}));

// Stands in for the correction popover, cloning the trigger it was handed the
// way Popover.Trigger's asChild does, so the test sees the element Zag would
// anchor on and hand focus back to.
vi.mock("../AnnotationPopover", async () => {
  const { cloneElement } = await import("react");
  return {
    AnnotationPopover: (props: {
      open: boolean;
      mode: string;
      annotationId?: string;
      trigger: React.ReactElement;
      onOpenChange: (open: boolean) => void;
    }) => (
      <>
        {cloneElement(props.trigger, {
          "data-testid": "correction-trigger",
          onClick: () => props.onOpenChange(true),
        } as Record<string, unknown>)}
        {props.open ? (
          <div
            data-testid="correction-popover"
            data-mode={props.mode}
            data-annotation-id={props.annotationId ?? ""}
          />
        ) : null}
      </>
    ),
  };
});

const { TurnAnnotationBadges } = await import("../TurnAnnotations");

const ANNOTATIONS = [
  {
    id: "annotation-1",
    comment: "the model invented a policy number",
    expectedOutput: null,
    user: { id: "user-1", name: "Ada", image: null },
    email: null,
    createdAt: new Date("2026-08-01T10:30:00Z"),
  },
  {
    id: "annotation-2",
    comment: "wrong total",
    expectedOutput: "Policy 4471 covers water damage.",
    user: { id: "user-2", name: "Grace", image: null },
    email: null,
    createdAt: new Date("2026-08-02T10:30:00Z"),
  },
] as unknown as React.ComponentProps<typeof TurnAnnotationBadges>["prefetchedItems"];

function renderBadges() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TurnAnnotationBadges
        traceId="trace-1"
        output="the original answer"
        prefetchedItems={ANNOTATIONS}
      />
    </ChakraProvider>,
  );
}

/** Open the badge's list, the way a reviewer reaches the annotations on a turn. */
async function openList(user: ReturnType<typeof userEvent.setup>) {
  renderBadges();
  await user.click(screen.getByRole("button", { name: /2 annotations/ }));
  await screen.findByText("Ada");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canManage = true;
});

afterEach(cleanup);

describe("given a turn carrying annotations", () => {
  describe("when the reviewer opens the badge", () => {
    /** @scenario "In bubbles layout, existing annotations are edited via the badge popover" */
    it("lists every annotation on the turn", async () => {
      await openList(userEvent.setup());

      expect(screen.getByText("Ada")).toBeInTheDocument();
      expect(screen.getByText("Grace")).toBeInTheDocument();
    });

    /** @scenario "In bubbles layout, existing annotations are edited via the badge popover" */
    it("hangs each correction popover off the line it belongs to", async () => {
      await openList(userEvent.setup());

      const triggers = screen.getAllByTestId("correction-trigger");

      expect(triggers).toHaveLength(2);
      for (const trigger of triggers) {
        // A hidden anchor would leave the keyboard nowhere to go on close.
        expect(trigger.tagName).toBe("BUTTON");
        expect(trigger).not.toHaveAttribute("aria-hidden");
      }
    });
  });

  describe("when the reviewer picks an annotation with the mouse", () => {
    /** @scenario "In bubbles layout, existing annotations are edited via the badge popover" */
    it("opens that annotation for editing", async () => {
      const user = userEvent.setup();
      await openList(user);

      await user.click(screen.getByRole("button", { name: /Ada/ }));

      const popover = screen.getByTestId("correction-popover");
      expect(popover).toHaveAttribute("data-annotation-id", "annotation-1");
      expect(popover).toHaveAttribute("data-mode", "annotate");
    });

    /** @scenario "In bubbles layout, existing annotations are edited via the badge popover" */
    it("opens a suggestion in the correction form", async () => {
      const user = userEvent.setup();
      await openList(user);

      await user.click(screen.getByRole("button", { name: /Grace/ }));

      expect(screen.getByTestId("correction-popover")).toHaveAttribute(
        "data-mode",
        "suggest",
      );
    });
  });

  describe("when the reviewer works the list from the keyboard", () => {
    /** @scenario "In bubbles layout, existing annotations are edited via the badge popover" */
    it("offers each line as a button, which Enter and Space activate", async () => {
      await openList(userEvent.setup());

      for (const row of screen.getAllByTestId("correction-trigger")) {
        // A native button is what carries Enter and Space, and what puts the
        // line in the tab order. A div wearing role="button" carries neither.
        expect(row.tagName).toBe("BUTTON");
        expect(row).not.toHaveAttribute("role");
        expect(row).not.toHaveAttribute("tabindex");
        expect(row).not.toBeDisabled();
      }
    });
  });
});

describe("given a reviewer who may read annotations but not write them", () => {
  beforeEach(() => {
    mocks.canManage = false;
  });

  describe("when the badge's list is open", () => {
    /** @scenario "In bubbles layout, existing annotations are edited via the badge popover" */
    it("reads as text, with no control to open an editor", async () => {
      await openList(userEvent.setup());

      expect(screen.getByText("Ada")).toBeInTheDocument();
      expect(screen.queryByTestId("correction-trigger")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Ada/ })).not.toBeInTheDocument();
    });
  });
});

/**
 * A comment on one span of a turn reads beside the turn in the rail and is
 * counted nowhere, so one reviewer marking up six steps leaves the turn's count
 * where it was. See specs/traces-v2/anchored-comments.feature.
 */
describe("given a badge reading a turn's annotations for itself", () => {
  it("asks only for what was said about the turn", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <TurnAnnotationBadges traceId="trace-1" output="the original answer" />
      </ChakraProvider>,
    );

    expect(mocks.annotationsForTrace).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "trace-1", anchor: "trace" }),
      expect.anything(),
    );
  });
});
