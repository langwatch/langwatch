/**
 * @vitest-environment jsdom
 *
 * The block channel, rendered (ADR-060 / specs/langy/langy-derived-cards
 * .feature + langy-choice-questions.feature): a settled assistant message
 * whose parts carry stamped `langy-card` parts renders the card WHERE THE
 * BLOCK SAT between prose; the browser renders the stamped part and never
 * re-parses fences out of recorded text; a failed block is a disclosure,
 * never a guessed card and never silence; and the choices card renders every
 * state — open, answered, superseded, dead ref — purely from the recorded
 * conversation, with the answer bound by blockId.
 *
 * Boundary mocks: router (SPA anchors), project hook (deep links), the tRPC
 * client (choices ref hydration), recharts' ResponsiveContainer (jsdom
 * measures 0x0).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { langyChoicesTimeline } from "../logic/langyChoicesTimeline";
import type { UIMessage } from "ai";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({}),
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 200 }),
  };
});

import { MessageContent } from "../components/MessageContent";

afterEach(cleanup);

const statsCardPart = {
  type: "langy-card",
  blockId: "b1",
  kind: "stats",
  provenance: "derived",
  card: {
    kind: "stats",
    blockId: "b1",
    title: "Yesterday at a glance",
    items: [{ label: "failures", value: 41 }],
  },
};

const choicesPart = (blockId: string) => ({
  type: "langy-card",
  blockId,
  kind: "choices",
  provenance: "derived",
  card: {
    kind: "choices",
    blockId,
    question: "Which agent should this scenario run against?",
    options: [
      { id: "staging", label: "Staging agent" },
      { id: "prod", label: "Production agent" },
    ],
  },
});

function assistantMessage(parts: unknown[]): UIMessage {
  return {
    id: "m-assistant",
    role: "assistant",
    parts,
    // Fixture boundary: stamped parts aren't members of the SDK's part
    // union — the same honest cast the history rehydration path documents.
  } as unknown as UIMessage;
}

function renderMessage(
  message: UIMessage,
  extra: Partial<Parameters<typeof MessageContent>[0]> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageContent
        message={message}
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
        {...extra}
      />
    </ChakraProvider>,
  );
}

describe("given a reply whose parts carry a stamped block between prose", () => {
  it("renders prose as prose and the card where the block sat, in derived chrome", () => {
    renderMessage(
      assistantMessage([
        { type: "text", text: "Here is the picture:" },
        statsCardPart,
        { type: "text", text: "That is the shape of it." },
      ]),
    );

    expect(screen.getByText("Here is the picture:")).toBeDefined();
    expect(screen.getByText("That is the shape of it.")).toBeDefined();
    // The provenance chrome — visibly marked derived (ADR-060 §4).
    expect(screen.getByText("Derived by Langy")).toBeDefined();
    expect(screen.getByText("Yesterday at a glance")).toBeDefined();
    expect(screen.getByText("failures")).toBeDefined();
  });
});

describe("given recorded text that happens to contain a fence", () => {
  it("renders it as text — the stamped part is the only card source", () => {
    renderMessage(
      assistantMessage([
        {
          type: "text",
          text: 'Quoted example:\n\n```langy-card\n{"kind": "stats", "blockId": "x", "items": [{"label": "fake", "value": 1}]}\n```\n\ndone.',
        },
      ]),
    );
    // No stamped part → no derived chrome, whatever the prose contains.
    expect(screen.queryByText("Derived by Langy")).toBeNull();
  });
});

describe("given a failed block part", () => {
  it("renders the collapsed disclosure and expands to the raw text", () => {
    renderMessage(
      assistantMessage([
        { type: "text", text: "before" },
        {
          type: "langy-card-failed",
          blockId: "failed-block-1",
          raw: '{"kind": "traces", "traces": [{"trace_id": "tr_fake"}]}',
        },
        { type: "text", text: "after" },
      ]),
    );

    const line = screen.getByText("Langy tried to draw a card here");
    expect(line).toBeDefined();
    // Raw hidden while collapsed; no card of any kind drawn from it.
    expect(screen.queryByText(/tr_fake/)).toBeNull();
    expect(screen.queryByText("Derived by Langy")).toBeNull();

    fireEvent.click(screen.getByText("View raw"));
    expect(screen.getByText(/tr_fake/)).toBeDefined();
  });
});

describe("given an open question card", () => {
  const message = assistantMessage([
    { type: "text", text: "One thing I need from you:" },
    choicesPart("q1"),
  ]);
  const timeline = langyChoicesTimeline([message]);

  it("answers with the option bound to its exact question", () => {
    const onChoiceSelect = vi.fn();
    renderMessage(message, { choicesTimeline: timeline, onChoiceSelect });

    fireEvent.click(screen.getByText("Staging agent"));
    expect(onChoiceSelect).toHaveBeenCalledTimes(1);
    expect(onChoiceSelect.mock.calls[0]![0]).toMatchObject({
      selection: { blockId: "q1", optionIds: ["staging"] },
    });
  });

  it("renders read-only without a select handler (time travel)", () => {
    renderMessage(message, { choicesTimeline: timeline });
    const option = screen.getByText("Staging agent").closest("button");
    expect(option?.disabled).toBe(true);
  });
});

describe("given an answered question", () => {
  it("renders locked with the choice marked, options unclickable", () => {
    const message = assistantMessage([choicesPart("q1")]);
    const timeline = langyChoicesTimeline([
      message,
      {
        role: "user",
        parts: [
          { type: "langy-choice-selection", blockId: "q1", optionIds: ["prod"] },
          { type: "text", text: "Chose: Production agent" },
        ],
      } as unknown as UIMessage,
    ]);
    const onChoiceSelect = vi.fn();
    renderMessage(message, { choicesTimeline: timeline, onChoiceSelect });

    const chosen = screen.getByText("Production agent").closest("button");
    expect(chosen?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByText("Staging agent"));
    fireEvent.click(screen.getByText("Production agent"));
    expect(onChoiceSelect).not.toHaveBeenCalled();
  });
});

describe("given a question the conversation moved past", () => {
  it("renders superseded — readable, visibly closed, unanswerable", () => {
    const message = assistantMessage([choicesPart("q1")]);
    const timeline = langyChoicesTimeline([
      message,
      {
        role: "user",
        parts: [{ type: "text", text: "unrelated follow-up" }],
      } as unknown as UIMessage,
    ]);
    const onChoiceSelect = vi.fn();
    renderMessage(message, { choicesTimeline: timeline, onChoiceSelect });

    // Still readable.
    expect(
      screen.getByText("Which agent should this scenario run against?"),
    ).toBeDefined();
    expect(
      screen.getByText("The conversation moved on — this question is closed."),
    ).toBeDefined();
    fireEvent.click(screen.getByText("Staging agent"));
    expect(onChoiceSelect).not.toHaveBeenCalled();
  });
});

describe("given no timeline at all", () => {
  it("fails closed: the question renders unanswerable", () => {
    const onChoiceSelect = vi.fn();
    renderMessage(assistantMessage([choicesPart("q1")]), { onChoiceSelect });
    fireEvent.click(screen.getByText("Staging agent"));
    expect(onChoiceSelect).not.toHaveBeenCalled();
  });
});

describe("given a derived timeseries with hints", () => {
  it("binds a validating explore hint to a Traces link", () => {
    renderMessage(
      assistantMessage([
        {
          type: "langy-card",
          blockId: "ts1",
          kind: "timeseries",
          provenance: "derived",
          card: {
            kind: "timeseries",
            blockId: "ts1",
            title: "Cost per day",
            series: [
              {
                name: "cost",
                points: [
                  { t: "d1", v: 1 },
                  { t: "d2", v: 2 },
                ],
              },
            ],
          },
          hints: [{ type: "explore", query: { query: "checkout" } }],
        },
      ]),
    );
    expect(screen.getByText("Derived by Langy")).toBeDefined();
    expect(screen.getByText("Open in Traces")).toBeDefined();
  });

  it("drops an explore hint the platform cannot validate, card intact", () => {
    renderMessage(
      assistantMessage([
        {
          type: "langy-card",
          blockId: "ts2",
          kind: "timeseries",
          provenance: "derived",
          card: {
            kind: "timeseries",
            blockId: "ts2",
            title: "Cost per day",
            series: [
              {
                name: "cost",
                points: [
                  { t: "d1", v: 1 },
                  { t: "d2", v: 2 },
                ],
              },
            ],
          },
          hints: [{ type: "explore", query: { nonsense: true } }],
        },
      ]),
    );
    expect(screen.queryByText("Open in Traces")).toBeNull();
    expect(screen.getByText("Cost per day")).toBeDefined();
  });
});

describe("given a card renderer that throws", () => {
  it("costs one card, never the answer around it", () => {
    // A stamped part whose card will explode the stats body: value is an
    // object, which formatCell/StreamingStatCard cannot have been built for.
    // parseLangyCardPart REFUSES it (strict schema), so it degrades to the
    // failed disclosure — and the prose around it still renders.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    renderMessage(
      assistantMessage([
        { type: "text", text: "healthy prose" },
        {
          type: "langy-card",
          blockId: "boom",
          kind: "stats",
          provenance: "derived",
          card: { kind: "stats", blockId: "boom", items: [{ label: 3 }] },
        },
      ]),
    );
    expect(screen.getByText("healthy prose")).toBeDefined();
    expect(screen.getByText("Langy tried to draw a card here")).toBeDefined();
    consoleError.mockRestore();
  });
});
