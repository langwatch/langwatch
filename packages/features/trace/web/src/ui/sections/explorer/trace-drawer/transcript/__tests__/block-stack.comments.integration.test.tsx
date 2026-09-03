/**
 * @vitest-environment jsdom
 *
 * Commenting on one message of a transcript. The block's key is what the
 * comment is stored against, so the same message is found again when the
 * transcript is read back and a message that was rewritten is not.
 * See specs/traces-v2/anchored-comments.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  canManageAnnotations: true,
  create: vi.fn(),
  comments: [] as unknown[],
}));

vi.mock("../../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: (permission: string) =>
      permission === "annotations:manage"
        ? mocks.canManageAnnotations
        : permission === "annotations:view",
  }),
}));

vi.mock("../../../hooks/use-anchored-annotations", async () => {
  const actual = await vi.importActual<typeof import("../../../hooks/use-anchored-annotations")>(
    "../../../hooks/use-anchored-annotations",
  );
  return {
    ...actual,
    useAnchoredAnnotations: () => ({
      commentsAt: () => mocks.comments,
      all: mocks.comments,
      isLoading: false,
    }),
  };
});

vi.mock("../../../../me/use-personal-feature-gate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: null,
  }),
}));

vi.mock("../../../../me/personal-feature-gate-dialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

vi.mock("../../../../use-annotation-invalidation", () => ({
  useAnnotationInvalidation: () => vi.fn(),
}));

vi.mock("@langwatch/design-system/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("../../../../trace-api", () => ({
  api: {
    annotation: {
      getByTraceId: { useQuery: () => ({ data: [] }) },
      create: {
        useMutation: () => ({ mutate: mocks.create, isLoading: false }),
      },
      updateByTraceId: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
      deleteById: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
    },
    annotationScore: {
      getAllActive: {
        useQuery: () => ({
          data: [
            {
              id: "score-1",
              name: "Helpfulness",
              description: null,
              dataType: "BOOLEAN",
              options: [{ label: "Good", value: "good" }],
            },
          ],
          isLoading: false,
        }),
      },
    },
  },
}));

import { BlockStack } from "../block-stack";
import { MessageCommentScope } from "../message-comments";
import { withBlockKeys } from "../parsing";
import type { ContentBlock } from "../types";

const TRACE_ID = "trace-1";
const BLOCKS: ContentBlock[] = [
  { kind: "text", text: "the first message" },
  { kind: "text", text: "the second message" },
];

function renderTranscript({ inTrace = true } = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageCommentScope traceId={inTrace ? TRACE_ID : undefined}>
        <BlockStack blocks={BLOCKS} toolCalls={[]} />
      </MessageCommentScope>
    </ChakraProvider>,
  );
}

const commentActions = () => screen.queryAllByRole("button", { name: /comment on this message/i });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canManageAnnotations = true;
  mocks.comments = [];
  cleanup();
});

describe("given a transcript of several messages inside a trace", () => {
  /** @scenario "Commenting on one message in a transcript records that message" */
  it("offers each message its own comment action", () => {
    renderTranscript();

    expect(commentActions()).toHaveLength(BLOCKS.length);
  });

  describe("when the reviewer comments on one of them", () => {
    /** @scenario "Commenting on one message in a transcript records that message" */
    it("records the comment against that message and no other", async () => {
      const user = userEvent.setup();
      renderTranscript();

      await user.click(commentActions()[1]!);
      await user.type(await screen.findByPlaceholderText("Optional"), "this one went off");
      await user.click(screen.getByRole("button", { name: "Save" }));

      const [payload] = mocks.create.mock.calls[0] as [Record<string, unknown>];
      expect(payload).toMatchObject({
        traceId: TRACE_ID,
        anchorKind: "message",
        anchorId: TRACE_ID,
        anchorPath: withBlockKeys(BLOCKS)[1]!.blockKey,
      });
      expect(payload.anchorPath).not.toBe(withBlockKeys(BLOCKS)[0]!.blockKey);
    });

    /** @scenario "A comment on a message offers no suggestion" */
    it("offers no correction to go with the comment", async () => {
      const user = userEvent.setup();
      renderTranscript();

      await user.click(commentActions()[0]!);

      await screen.findByPlaceholderText("Optional");
      expect(
        screen.queryByPlaceholderText("What should the output have been?"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Suggest correction")).not.toBeInTheDocument();
    });

    /** @scenario "A comment on one part of a trace is offered the same scores" */
    it("offers the project's scores on the comment", async () => {
      const user = userEvent.setup();
      renderTranscript();

      await user.click(commentActions()[0]!);

      await screen.findByPlaceholderText("Optional");
      expect(screen.getByText("Scores")).toBeInTheDocument();
    });
  });
});

describe("given a transcript rendered outside a trace the reader can annotate", () => {
  it("offers no message any comment action", () => {
    renderTranscript({ inTrace: false });

    expect(commentActions()).toHaveLength(0);
    expect(screen.getByText("the first message")).toBeInTheDocument();
  });
});

describe("given a reader who may only read annotations", () => {
  /** @scenario "A reviewer who may only read annotations is offered no comment action" */
  it("offers no message any comment action", () => {
    mocks.canManageAnnotations = false;

    renderTranscript();

    expect(commentActions()).toHaveLength(0);
  });
});
