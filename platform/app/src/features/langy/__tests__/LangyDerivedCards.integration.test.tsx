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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { cloneElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { langyChoicesTimeline } from "../logic/langyChoicesTimeline";

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
    useUtils: () => ({}),
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

import { LangyChoicesCard } from "../components/derived-cards/LangyChoicesCard";
import { MessageContent } from "../components/MessageContent";

afterEach(cleanup);

/**
 * The derived frame's provenance hooks (ADR-060 §4).
 *
 * Asserted through the frame's data attributes rather than its overline copy:
 * the mark that a card is derived is the frame itself, and pinning these to a
 * particular wording is what made every copy edit a test edit.
 */
const derivedFrames = () =>
  document.querySelectorAll("[data-derived-by-langy]");
const formingFrames = () => document.querySelectorAll("[data-derived-forming]");

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

function assistantMessage({
  parts,
  metadata = {},
}: {
  parts: unknown[];
  metadata?: Record<string, unknown>;
}): UIMessage {
  return {
    id: "m-assistant",
    role: "assistant",
    parts,
    metadata,
    // Fixture boundary: stamped parts aren't members of the SDK's part
    // union — the same honest cast the history rehydration path documents.
  } as unknown as UIMessage;
}

/** As the durable fold hands it to the engine — the relay has ruled on it. */
const recorded = { recorded: true };

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
      assistantMessage({
        parts: [
          { type: "text", text: "Here is the picture:" },
          statsCardPart,
          { type: "text", text: "That is the shape of it." },
        ],
      }),
    );

    expect(screen.getByText("Here is the picture:")).toBeDefined();
    expect(screen.getByText("That is the shape of it.")).toBeDefined();
    // The provenance chrome — visibly marked derived (ADR-060 §4).
    expect(derivedFrames()).toHaveLength(1);
    expect(screen.getByText("Yesterday at a glance")).toBeDefined();
    expect(screen.getByText("failures")).toBeDefined();
  });
});

const FENCED_TEXT = {
  type: "text",
  text: 'Quoted example:\n\n```langy-card\n{"kind": "stats", "blockId": "x", "items": [{"label": "fake", "value": 1}]}\n```\n\ndone.',
};

describe("given recorded text that happens to contain a fence", () => {
  it("renders it as text — for a recorded reply the stamped part is the only card source", () => {
    renderMessage(
      assistantMessage({ parts: [FENCED_TEXT], metadata: recorded }),
    );
    // The relay saw this text and stamped nothing, so nothing is a card.
    expect(derivedFrames()).toHaveLength(0);
  });
});

describe("given the copy this browser streamed for itself", () => {
  /** @scenario "A settled turn's cards reach the reader who watched it stream" */
  it("draws the fence as a card, because nothing ever stamped this copy", () => {
    renderMessage(assistantMessage({ parts: [FENCED_TEXT] }));

    expect(derivedFrames()).toHaveLength(1);
    expect(screen.getByText("fake")).toBeDefined();
    expect(screen.getByText("Quoted example:")).toBeDefined();
    expect(screen.getByText("done.")).toBeDefined();
  });
});

describe("given a failed block part", () => {
  it("renders the collapsed disclosure and expands to the raw text", () => {
    renderMessage(
      assistantMessage({
        parts: [
          { type: "text", text: "before" },
          {
            type: "langy-card-failed",
            blockId: "failed-block-1",
            raw: '{"kind": "traces", "traces": [{"trace_id": "tr_fake"}]}',
          },
          { type: "text", text: "after" },
        ],
      }),
    );

    const line = screen.getByText("Langy tried to draw a card here");
    expect(line).toBeDefined();
    // Raw hidden while collapsed; no card of any kind drawn from it.
    expect(screen.queryByText(/tr_fake/)).toBeNull();
    expect(derivedFrames()).toHaveLength(0);

    fireEvent.click(screen.getByText("View raw"));
    expect(screen.getByText(/tr_fake/)).toBeDefined();
  });
});

describe("given an open question card", () => {
  const message = assistantMessage({
    parts: [
      { type: "text", text: "One thing I need from you:" },
      choicesPart("q1"),
    ],
  });
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

// Langy asks through its `question` tool, which the panel turns into the same
// choices card (see LangyQuestionToolCard.integration.test.tsx). A choices
// FENCE is therefore a kind the card channel does not know, and it degrades
// like any other unknown card rather than opening a second asking path the
// tool wait knows nothing about.
describe("given a choices fence in the assistant's own prose", () => {
  const FENCED_QUESTION = {
    type: "text",
    text: 'One thing I need from you:\n\n```langy-card\n{"kind":"choices","blockId":"q1","question":"Which agent should this scenario run against?","options":[{"id":"staging","label":"Staging agent"},{"id":"prod","label":"Production agent"}]}\n```',
  };

  it("degrades to the disclosure, with nothing to answer", () => {
    const message = assistantMessage({ parts: [FENCED_QUESTION] });
    renderMessage(message, {
      choicesTimeline: langyChoicesTimeline([message]),
      onChoiceSelect: vi.fn(),
    });

    expect(screen.queryByText("Staging agent")).toBeNull();
    expect(derivedFrames()).toHaveLength(0);
    expect(screen.getByText("Langy tried to draw a card here")).toBeDefined();
  });

  it("puts no question on the timeline, so nothing binds an answer to it", () => {
    const message = assistantMessage({ parts: [FENCED_QUESTION] });
    expect(langyChoicesTimeline([message])).toEqual([{ kind: "message" }]);
  });
});

describe("given an answered question", () => {
  it("renders locked with the choice marked, options unclickable", () => {
    const message = assistantMessage({ parts: [choicesPart("q1")] });
    const timeline = langyChoicesTimeline([
      message,
      {
        role: "user",
        parts: [
          {
            type: "langy-choice-selection",
            blockId: "q1",
            optionIds: ["prod"],
          },
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
    const message = assistantMessage({ parts: [choicesPart("q1")] });
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
    renderMessage(assistantMessage({ parts: [choicesPart("q1")] }), {
      onChoiceSelect,
    });
    fireEvent.click(screen.getByText("Staging agent"));
    expect(onChoiceSelect).not.toHaveBeenCalled();
  });
});

describe("given a derived timeseries with hints", () => {
  it("binds a validating explore hint to a Traces link", () => {
    renderMessage(
      assistantMessage({
        parts: [
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
        ],
      }),
    );
    expect(derivedFrames()).toHaveLength(1);
    const link = screen.getByText("Open in Traces").closest("a");
    // A derived hint carries no dates and makes no claim about when its data is
    // from, so the link must NOT stamp the CLI's 24h default on it — that would
    // point a card summarising older data at a one-day window and show nothing.
    expect(link?.getAttribute("href")).toBe(
      "/demo/traces#all-traces?q=%22checkout%22",
    );
  });

  it("binds an explore hint narrowed only by origin, no free text", () => {
    // `origin` is a real field the model is told about (fieldCatalogue.ts),
    // so a hint naming only one is a genuine narrowing, not an empty query —
    // it must earn a link the same way a free-text hint does.
    renderMessage(
      assistantMessage({
        parts: [
          {
            type: "langy-card",
            blockId: "ts3",
            kind: "timeseries",
            provenance: "derived",
            card: {
              kind: "timeseries",
              blockId: "ts3",
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
            hints: [{ type: "explore", query: { origin: "evaluation" } }],
          },
        ],
      }),
    );
    const link = screen.getByText("Open in Traces").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "/demo/traces#all-traces?q=origin%3Aevaluation",
    );
  });

  it("drops an explore hint the platform cannot validate, card intact", () => {
    renderMessage(
      assistantMessage({
        parts: [
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
        ],
      }),
    );
    expect(screen.queryByText("Open in Traces")).toBeNull();
    expect(screen.getByText("Cost per day")).toBeDefined();
  });
});

describe("given an option labeled with an action and grounded in a resource", () => {
  /** @scenario "A grounded option still reads as the answer it is" */
  it("reads as its own label, with the resource's current name as detail", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <LangyChoicesCard
          card={{
            kind: "choices",
            blockId: "q-publish",
            question: "Publish the winner?",
            options: [
              {
                id: "publish",
                label: "Publish the winning draft",
                ref: { type: "prompt", id: "prompt_1" },
              },
            ],
          }}
          lockState={{ status: "open" }}
          onSelect={vi.fn()}
          refRowsOverride={
            new Map([
              [
                "publish",
                {
                  state: "live",
                  primary: "support-reply-v1",
                  secondary: "version 3",
                },
              ],
            ])
          }
        />
      </ChakraProvider>,
    );

    expect(screen.getByText("Publish the winning draft")).toBeDefined();
    expect(screen.getByText("support-reply-v1 · version 3")).toBeDefined();
  });
});

describe("given an option whose entity no longer exists", () => {
  it("renders it disabled and says the thing is gone — unselectable", () => {
    const onSelect = vi.fn();
    render(
      <ChakraProvider value={defaultSystem}>
        <LangyChoicesCard
          card={{
            kind: "choices",
            blockId: "q-refs",
            question: "Which agent?",
            options: [
              {
                id: "live",
                label: "checkout-agent",
                ref: { type: "agent", id: "agent_live" },
              },
              {
                id: "dead",
                label: "retired-agent",
                ref: { type: "agent", id: "agent_gone" },
              },
            ],
          }}
          lockState={{ status: "open" }}
          onSelect={onSelect}
          refRowsOverride={
            new Map([
              ["live", { state: "live", primary: "checkout-agent" }],
              ["dead", { state: "dead" }],
            ])
          }
        />
      </ChakraProvider>,
    );

    expect(screen.getByText("No longer exists")).toBeDefined();
    fireEvent.click(screen.getByText("retired-agent"));
    expect(onSelect).not.toHaveBeenCalled();
    // The live sibling stays selectable.
    fireEvent.click(screen.getByText("checkout-agent"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("given a question that allows Other", () => {
  it("answers with the typed free text like any option would", () => {
    const onSelect = vi.fn();
    render(
      <ChakraProvider value={defaultSystem}>
        <LangyChoicesCard
          card={{
            kind: "choices",
            blockId: "q-other",
            question: "Which agent?",
            options: [{ id: "a", label: "Agent A" }],
            allowOther: true,
          }}
          lockState={{ status: "open" }}
          onSelect={onSelect}
        />
      </ChakraProvider>,
    );

    fireEvent.click(screen.getByText("Other…"));
    fireEvent.change(screen.getByPlaceholderText("Your own answer…"), {
      target: { value: "my local agent" },
    });
    fireEvent.click(screen.getByText("Send"));
    expect(onSelect).toHaveBeenCalledWith({
      selection: {
        blockId: "q-other",
        optionIds: [],
        otherText: "my local agent",
      },
      card: expect.objectContaining({ blockId: "q-other" }) as unknown,
    });
  });
});

describe("given a turn streaming a block (ADR-060 §7)", () => {
  const statsFenceOpen =
    'Plotting this now:\n```langy-card\n{"kind": "stats", "blockId": "live1", "title": "Live counts", "items": [';

  it("shows no card preview until a validating prefix exists", () => {
    renderMessage(
      assistantMessage({ parts: [{ type: "text", text: statsFenceOpen }] }),
      {
        isStreaming: true,
      },
    );
    expect(screen.getByText(/Plotting/)).toBeDefined();
    expect(derivedFrames()).toHaveLength(0);
  });

  it("renders the forming card once the prefix validates, marked forming", () => {
    renderMessage(
      assistantMessage({
        parts: [
          {
            type: "text",
            text: `${statsFenceOpen}{"label": "traces", "value": 12}`,
          },
        ],
      }),
      { isStreaming: true },
    );
    expect(formingFrames()).toHaveLength(1);
    expect(screen.getByText("Live counts")).toBeDefined();
    expect(screen.getByText("traces")).toBeDefined();
  });

  it("replaces the preview with the settled card — exactly one card renders", () => {
    const { rerender } = renderMessage(
      assistantMessage({
        parts: [
          {
            type: "text",
            text: `${statsFenceOpen}{"label": "traces", "value": 12}`,
          },
        ],
      }),
      { isStreaming: true },
    );
    expect(formingFrames()).toHaveLength(1);

    // The turn settles: the durable parts replace the streamed text — the
    // stamped part is the truth, the preview is gone with the stream.
    rerender(
      <ChakraProvider value={defaultSystem}>
        <MessageContent
          message={assistantMessage({
            parts: [
              { type: "text", text: "Plotting this now:" },
              {
                type: "langy-card",
                blockId: "live1",
                kind: "stats",
                provenance: "derived",
                card: {
                  kind: "stats",
                  blockId: "live1",
                  title: "Live counts",
                  items: [{ label: "traces", value: 12 }],
                },
              },
            ],
          })}
          appliedOutcomes={{}}
          discardedProposals={new Set()}
          applyingProposals={new Set()}
          onApply={async () => {}}
          onDiscard={() => {}}
        />
      </ChakraProvider>,
    );

    expect(formingFrames()).toHaveLength(0);
    expect(derivedFrames()).toHaveLength(1);
    expect(screen.getByText("Live counts")).toBeDefined();
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
      assistantMessage({
        parts: [
          { type: "text", text: "healthy prose" },
          {
            type: "langy-card",
            blockId: "boom",
            kind: "stats",
            provenance: "derived",
            card: { kind: "stats", blockId: "boom", items: [{ label: 3 }] },
          },
        ],
      }),
    );
    expect(screen.getByText("healthy prose")).toBeDefined();
    expect(screen.getByText("Langy tried to draw a card here")).toBeDefined();
    consoleError.mockRestore();
  });
});

/**
 * @see specs/langy/langy-derived-stats-presentation.feature
 */
describe("given a stats card comparing readings on one scale", () => {
  const comparison = {
    type: "langy-card",
    blockId: "cmp",
    kind: "stats",
    provenance: "derived",
    card: {
      kind: "stats",
      blockId: "cmp",
      title: "Baseline vs candidate",
      items: [
        { label: "Baseline pass rate", value: 35, unit: "percent" },
        { label: "Candidate pass rate", value: 45, unit: "percent" },
      ],
    },
  };

  /** @scenario "The bar comparison marks the leading reading" */
  it("draws a bar per reading and marks the leading one", () => {
    renderMessage(assistantMessage({ parts: [comparison] }));

    const bars = screen.getAllByTestId("derived-stat-bar");
    expect(bars).toHaveLength(2);
    expect(bars.filter((bar) => bar.dataset.best === "true")).toHaveLength(1);
    expect(bars[1]!.dataset.best).toBe("true");
  });

  /** @scenario "A unit word is drawn as the symbol a reader expects" */
  it("draws each unit as its symbol", () => {
    renderMessage(assistantMessage({ parts: [comparison] }));

    expect(screen.getByText("35%")).toBeDefined();
    expect(screen.getByText("45%")).toBeDefined();
  });

  /** @scenario "The figure row wraps rather than leaving the panel" */
  it("keeps every reading in the card rather than dropping any", () => {
    renderMessage(
      assistantMessage({
        parts: [
          {
            ...comparison,
            card: {
              ...comparison.card,
              items: [
                ...comparison.card.items,
                { label: "Policy-sheet rows", value: 83, unit: "percent" },
                { label: "Shipping-window rows", value: 60, unit: "percent" },
              ],
            },
          },
        ],
      }),
    );

    expect(screen.getAllByTestId("derived-stat-bar")).toHaveLength(4);
    expect(screen.getByText("Shipping-window rows")).toBeDefined();
  });
});
