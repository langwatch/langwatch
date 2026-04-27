/**
 * @vitest-environment jsdom
 *
 * Integration tests for MessageHoverActions lite member restrictions.
 * Verifies that EXTERNAL users do not see the "View Trace" button
 * but can still see Translate, Annotate, and Suggest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../../hooks/useLiteMemberGuard", () => ({
  useLiteMemberGuard: vi.fn(),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test" },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    drawerOpen: vi.fn(() => false),
  }),
}));

vi.mock("~/hooks/useTraceDetailsDrawer", () => ({
  useTraceDetailsDrawer: () => ({
    openTraceDetailsDrawer: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useAnnotationCommentStore", () => ({
  useAnnotationCommentStore: () => ({
    setCommentState: vi.fn(),
  }),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    translate: {
      translate: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock("../../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("../../ui/tooltip", () => ({
  Tooltip: ({
    children,
    content,
  }: {
    children: React.ReactNode;
    content: string;
  }) => <div data-tooltip={content}>{children}</div>,
}));

import { useLiteMemberGuard } from "../../../hooks/useLiteMemberGuard";
import {
  MessageHoverActions,
  useTranslationState,
} from "../MessageHoverActions";
import type { Trace } from "../../../server/tracer/types";

const mockUseLiteMemberGuard = vi.mocked(useLiteMemberGuard);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeTrace = {
  trace_id: "t-1",
  output: { value: "hello" },
  input: { value: "hi" },
} as unknown as Trace;

function TranslationWrapper({ isLiteMember }: { isLiteMember: boolean }) {
  mockUseLiteMemberGuard.mockReturnValue({ isLiteMember });

  const translationState = useTranslationState();
  return (
    <ChakraProvider value={defaultSystem}>
      <MessageHoverActions trace={fakeTrace} {...translationState} />
    </ChakraProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MessageHoverActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when user is a lite member", () => {
    it("does not render the View Trace button", () => {
      const { container } = render(
        <TranslationWrapper isLiteMember={true} />,
      );

      const tooltips = container.querySelectorAll("[data-tooltip]");
      const labels = Array.from(tooltips).map((el) =>
        el.getAttribute("data-tooltip"),
      );

      expect(labels).not.toContain("View Trace");
    });

    it("renders the Translate button", () => {
      const { container } = render(
        <TranslationWrapper isLiteMember={true} />,
      );

      const tooltips = container.querySelectorAll("[data-tooltip]");
      const labels = Array.from(tooltips).map((el) =>
        el.getAttribute("data-tooltip"),
      );

      expect(labels).toContain("Translate message to English");
    });

    it("renders the Annotate button", () => {
      const { container } = render(
        <TranslationWrapper isLiteMember={true} />,
      );

      const tooltips = container.querySelectorAll("[data-tooltip]");
      const labels = Array.from(tooltips).map((el) =>
        el.getAttribute("data-tooltip"),
      );

      expect(labels).toContain("Annotate");
    });

    it("renders the Suggest button", () => {
      const { container } = render(
        <TranslationWrapper isLiteMember={true} />,
      );

      const tooltips = container.querySelectorAll("[data-tooltip]");
      const labels = Array.from(tooltips).map((el) =>
        el.getAttribute("data-tooltip"),
      );

      expect(labels).toContain("Suggest");
    });
  });

  describe("when user is a full member", () => {
    it("renders the View Trace button", () => {
      const { container } = render(
        <TranslationWrapper isLiteMember={false} />,
      );

      const tooltips = container.querySelectorAll("[data-tooltip]");
      const labels = Array.from(tooltips).map((el) =>
        el.getAttribute("data-tooltip"),
      );

      expect(labels).toContain("View Trace");
    });

    it("renders all four action buttons", () => {
      const { container } = render(
        <TranslationWrapper isLiteMember={false} />,
      );

      const tooltips = container.querySelectorAll("[data-tooltip]");
      expect(tooltips.length).toBe(4);
    });
  });
});
