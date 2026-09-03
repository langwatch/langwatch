/**
 * @vitest-environment jsdom
 *
 * The block channel, rendered (ADR-060 / specs/langy/langy-derived-cards
 * .feature + langy-derived-stats-presentation.feature): the copy this browser
 * streamed for itself draws its fences as cards because nothing ever stamped
 * it; a streamed question is answerable because the timeline reads the same
 * fences the panel draws; a loosely written opening fence still previews; and
 * a stats card keeps every reading in the card.
 *
 * MOVED from `platform/app/src/features/langy/__tests__/LangyDerivedCards
 * .integration.test.tsx` and `StreamingCardFenceForms.integration.test.tsx`.
 *
 * Boundary mocks: router (SPA anchors), project hook (deep links), the tRPC
 * client (choices ref hydration).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { langyChoicesTimeline } from "../../../../../model/langy-choices-timeline";

vi.mock("../../../../../behavior/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@langwatch/workflow-web/studio-host/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
  }),
}));

vi.mock("../../../../../behavior/langy-api", async () => {
  const { withFallback, idleQuery, noopMutation } =
    await import("../../../__tests__/support/langy-api-mock");
  return {
    api: withFallback({
      useUtils: () => ({}),
      dashboards: {
        getAll: { useQuery: () => ({ data: [] }) },
        create: { useMutation: noopMutation },
      },
      graphs: { create: { useMutation: noopMutation } },
      langy: withFallback({ list: { useQuery: idleQuery } }),
    }),
  };
});

import { MessageContent } from "../message-content";
import { StreamingAnswerWithCards } from "../derived-cards/streaming-answer-with-cards";

afterEach(cleanup);

const derivedFrames = () => document.querySelectorAll("[data-derived-by-langy]");

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

const FENCED_TEXT = {
  type: "text",
  text: 'Quoted example:\n\n```langy-card\n{"kind": "stats", "blockId": "x", "items": [{"label": "fake", "value": 1}]}\n```\n\ndone.',
};

describe("given recorded text that happens to contain a fence", () => {
  it("renders it as text — for a recorded reply the stamped part is the only card source", () => {
    renderMessage(assistantMessage({ parts: [FENCED_TEXT], metadata: recorded }));
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

describe("given a question the browser streamed and nothing stamped", () => {
  const FENCED_QUESTION = {
    type: "text",
    text: 'One thing I need from you:\n\n```langy-card\n{"kind":"choices","blockId":"q1","question":"Which agent should this scenario run against?","options":[{"id":"staging","label":"Staging agent"},{"id":"prod","label":"Production agent"}]}\n```',
  };

  /** @scenario "A settled turn's cards reach the reader who watched it stream" */
  it("is answerable, because the timeline reads the same fences the panel draws", () => {
    const message = assistantMessage({ parts: [FENCED_QUESTION] });
    const onChoiceSelect = vi.fn();
    renderMessage(message, {
      choicesTimeline: langyChoicesTimeline([message]),
      onChoiceSelect,
    });

    fireEvent.click(screen.getByText("Staging agent"));
    expect(onChoiceSelect.mock.calls[0]?.[0]).toMatchObject({
      selection: { blockId: "q1", optionIds: ["staging"] },
    });
  });

  it("stays closed once the message is the durable record's", () => {
    const message = assistantMessage({
      parts: [FENCED_QUESTION],
      metadata: recorded,
    });
    renderMessage(message, {
      choicesTimeline: langyChoicesTimeline([message]),
      onChoiceSelect: vi.fn(),
    });

    expect(screen.queryByText("Staging agent")).toBeNull();
  });
});

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

    for (const label of [
      "Baseline pass rate",
      "Candidate pass rate",
      "Policy-sheet rows",
      "Shipping-window rows",
    ]) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });
});

describe("StreamingAnswerWithCards", () => {
  const CARD_JSON = JSON.stringify({
    kind: "stats",
    blockId: "winner-margin",
    items: [{ label: "Winner pass rate", value: 100, unit: "%" }],
  });

  const streamWith = (opening: string): string =>
    ["Version A wins.", opening, CARD_JSON, "```", "Ready to publish."].join("\n");

  const renderStream = (text: string) =>
    render(
      <ChakraProvider value={defaultSystem}>
        <StreamingAnswerWithCards text={text} />
      </ChakraProvider>,
    );

  describe("given an opening fence written loosely", () => {
    /** @scenario "A loosely written opening still draws a card" */
    it.each([
      ["the plain form", "```langy-card"],
      ["a space before the tag", "``` langy-card"],
      ["an indented fence", "  ```langy-card"],
      ["four backticks", "````langy-card"],
    ])("previews the card for %s", (_name, opening) => {
      renderStream(streamWith(opening));

      expect(screen.getByText("Winner pass rate")).toBeDefined();
      expect(screen.queryByText(/"blockId"/)).toBeNull();
    });
  });

  describe("given prose with an ordinary code block", () => {
    it("renders the block as text and no card", () => {
      renderStream(["Here is the shape:", "```json", "{}", "```"].join("\n"));

      expect(derivedFrames()).toHaveLength(0);
    });
  });
});
