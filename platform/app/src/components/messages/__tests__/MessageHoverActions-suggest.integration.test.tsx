/**
 * @vitest-environment jsdom
 *
 * Suggesting a correction from the legacy conversation goes through the same
 * correction popover the trace drawer uses, instead of seeding a draft into
 * the comment sidebar.
 * See specs/annotations/annotation-queue-workflow.feature and
 * specs/traces-v2/annotations.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  setCommentState: vi.fn(),
}));

vi.mock("~/hooks/useLiteMemberGuard", () => ({
  useLiteMemberGuard: () => ({ isLiteMember: false }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ drawerOpen: vi.fn(() => false) }),
}));

vi.mock("~/hooks/useTraceDetailsDrawer", () => ({
  useTraceDetailsDrawer: () => ({ openTraceDetailsDrawer: vi.fn() }),
}));

vi.mock("~/hooks/useAnnotationCommentStore", () => ({
  useAnnotationCommentStore: () => ({ setCommentState: mocks.setCommentState }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    translate: {
      translate: {
        useMutation: () => ({ mutateAsync: vi.fn(), isLoading: false }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({
    children,
    content,
  }: {
    children: React.ReactNode;
    content: string;
  }) => <div data-tooltip={content}>{children}</div>,
}));

vi.mock(
  "~/features/traces-v2/components/TraceDrawer/conversationView/AnnotationPopover",
  () => ({
    AnnotationPopover: (props: {
      open: boolean;
      mode: string;
      traceId: string;
      output?: string | null;
      annotationId?: string;
    }) =>
      props.open ? (
        <div
          data-testid="correction-popover"
          data-mode={props.mode}
          data-trace-id={props.traceId}
          data-output={props.output ?? ""}
          data-annotation-id={props.annotationId ?? ""}
        />
      ) : null,
  }),
);

import type { Trace } from "~/server/tracer/types";
import {
  MessageHoverActions,
  useTranslationState,
} from "../MessageHoverActions";

const trace = {
  trace_id: "trace-1",
  input: { value: "hi" },
  output: { value: "the original answer" },
} as unknown as Trace;

function Harness() {
  const translationState = useTranslationState();
  return (
    <ChakraProvider value={defaultSystem}>
      <MessageHoverActions trace={trace} {...translationState} />
    </ChakraProvider>
  );
}

const suggestButton = () => screen.getByRole("button", { name: "Suggest" });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("given a reviewer reading a message in the legacy conversation", () => {
  describe("when the reviewer uses the suggest action", () => {
    /** @scenario "The suggest action on a queued message opens the correction popover" */
    it("opens the correction popover for that message's trace", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.click(suggestButton());

      const popover = screen.getByTestId("correction-popover");
      expect(popover).toHaveAttribute("data-trace-id", "trace-1");
      expect(mocks.setCommentState).not.toHaveBeenCalled();
    });

    /** @scenario "The legacy conversation suggests through the same correction popover" */
    it("opens it in suggest mode pre-filled with the current output", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.click(suggestButton());

      const popover = screen.getByTestId("correction-popover");
      expect(popover).toHaveAttribute("data-mode", "suggest");
      expect(popover).toHaveAttribute("data-output", "the original answer");
    });
  });

  describe("when the reviewer has not used the suggest action", () => {
    it("keeps the correction popover out of the page", () => {
      render(<Harness />);

      expect(
        screen.queryByTestId("correction-popover"),
      ).not.toBeInTheDocument();
    });
  });
});
