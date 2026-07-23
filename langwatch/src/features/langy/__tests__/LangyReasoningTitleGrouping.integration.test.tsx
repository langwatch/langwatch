/**
 * @vitest-environment jsdom
 *
 * A settled codex turn's reasoning-summary headlines ("Planning task
 * execution strategy") belong to the turn's process record, not the reply:
 * they fold into the completed-actions receipt instead of standing as loose
 * bold paragraphs, and the reply text renders as its own block — never glued
 * onto the last headline ("…trace countsMostly Langy conversations…").
 *
 * Boundary mocks: router (SPA anchors), project hook (deep links), the tRPC
 * client and recharts (loaded transitively by the derived-card renderers).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
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

const REPLY = "Mostly Langy conversations and assistant responses.";

const TITLES = [
  "Planning task execution strategy",
  "Starting batch trace search",
  "Adjusting langwatch output limits",
  "Planning JSON output with jq filtering",
  "Planning JSON query with jq",
  "Summarizing recent trace counts",
];

// Two settled generic tool calls in two groups — the "2 actions completed"
// receipt the headlines fold into.
const settledToolParts = [
  {
    type: "tool-grep",
    toolCallId: "call-1",
    state: "output-available",
    input: { pattern: "traces" },
    output: "ok",
  },
  {
    type: "tool-webfetch",
    toolCallId: "call-2",
    state: "output-available",
    input: { url: "https://example.com" },
    output: "ok",
  },
];

function assistantMessage(parts: unknown[]): UIMessage {
  return {
    id: "m-assistant",
    role: "assistant",
    parts,
    // Fixture boundary: leaked/reasoning parts aren't members of the SDK's
    // part union — the same honest cast the history rehydration path uses.
  } as unknown as UIMessage;
}

function renderMessage(message: UIMessage) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageContent
        message={message}
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
      />
    </ChakraProvider>,
  );
}

/**
 * The shape the agent manager records today: reasoning headlines baked into
 * the single text part as `**Title**` paragraphs, the last one glued onto the
 * reply.
 */
function leakedHeadlinesMessage(): UIMessage {
  const text = [
    "**Planning task execution strategy**",
    "",
    "**Starting batch trace search**",
    "",
    "**Adjusting langwatch output limits**",
    "",
    "**Planning JSON output with jq filtering**",
    "",
    "**Planning JSON query with jq**",
    "",
    `**Summarizing recent trace counts**${REPLY}`,
  ].join("\n");
  return assistantMessage([
    ...settledToolParts,
    { type: "text", text, role: "assistant" },
  ]);
}

/** The parts shape: reasoning parts interleaved with tools, then the reply. */
function reasoningPartsMessage(): UIMessage {
  return assistantMessage([
    { type: "reasoning", text: "Planning task execution strategy" },
    ...settledToolParts,
    { type: "reasoning", text: "Planning JSON query with jq" },
    { type: "reasoning", text: "Summarizing recent trace counts" },
    { type: "text", text: REPLY, role: "assistant" },
  ]);
}

describe("given a settled turn whose text carries leaked reasoning headlines", () => {
  it("renders no headline as a standalone bold paragraph", () => {
    const { container } = renderMessage(leakedHeadlinesMessage());
    const boldRuns = Array.from(container.querySelectorAll("strong")).map(
      (el) => el.textContent,
    );
    for (const title of TITLES) {
      expect(boldRuns).not.toContain(title);
    }
  });

  it("folds the headlines into the completed-actions receipt", () => {
    renderMessage(leakedHeadlinesMessage());
    expect(screen.getByText(/actions completed/)).toBeInTheDocument();
    // The receipt renders expanded on settle, so the folded thinking steps
    // are on screen as rows of its list.
    const rows = screen
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "");
    for (const title of TITLES) {
      expect(rows.some((row) => row.includes(title))).toBe(true);
    }
  });

  it("renders the reply as its own block, never glued to a headline", () => {
    renderMessage(leakedHeadlinesMessage());
    // The reply paragraph holds the reply and nothing else — before the fix it
    // read "**Summarizing recent trace counts**Mostly Langy conversations…",
    // the headline glued onto the reply's first word.
    const reply = screen.getByText(REPLY);
    expect(reply.closest("p")?.textContent).toBe(REPLY);
  });
});

describe("given a settled turn whose parts carry reasoning parts", () => {
  it("never renders reasoning text as answer prose", () => {
    const { container } = renderMessage(reasoningPartsMessage());
    const boldRuns = Array.from(container.querySelectorAll("strong")).map(
      (el) => el.textContent,
    );
    expect(boldRuns).not.toContain("Planning task execution strategy");
    // The reply paragraph holds only the reply.
    expect(screen.getByText(REPLY)).toBeInTheDocument();
  });

  it("accounts for the reasoning headlines in the completed receipt", () => {
    renderMessage(reasoningPartsMessage());
    const rows = screen
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "");
    expect(
      rows.some((row) => row.includes("Planning task execution strategy")),
    ).toBe(true);
    expect(
      rows.some((row) => row.includes("Summarizing recent trace counts")),
    ).toBe(true);
  });
});

describe("given a settled turn whose process record is a plan", () => {
  // With a plan, the plan card replaces the completed-actions receipt as the
  // turn's process record, so the folded headlines must ride the plan card:
  // stripped from the reply but never dropped.
  function planMessage(): UIMessage {
    const text = [
      "**Planning task execution strategy**",
      "",
      `**Summarizing recent trace counts**${REPLY}`,
    ].join("\n");
    return assistantMessage([
      {
        type: "tool-todowrite",
        toolCallId: "call-plan",
        state: "output-available",
        input: {
          todos: [
            { content: "Search the traces", status: "completed" },
            { content: "Summarize the findings", status: "completed" },
          ],
        },
        output: "ok",
      },
      { type: "text", text, role: "assistant" },
    ]);
  }

  it("renders no headline as a standalone bold paragraph", () => {
    const { container } = renderMessage(planMessage());
    const boldRuns = Array.from(container.querySelectorAll("strong")).map(
      (el) => el.textContent,
    );
    expect(boldRuns).not.toContain("Planning task execution strategy");
    expect(boldRuns).not.toContain("Summarizing recent trace counts");
  });

  it("shows the folded headlines inside the plan card's expanded checklist", () => {
    renderMessage(planMessage());

    fireEvent.click(screen.getByRole("button", { name: /plan · 2 of 2/i }));

    const planCard = screen.getByLabelText("Langy plan");
    const rows = Array.from(planCard.querySelectorAll("[role='listitem']")).map(
      (row) => row.textContent ?? "",
    );
    expect(
      rows.some((row) => row.includes("Planning task execution strategy")),
    ).toBe(true);
    expect(
      rows.some((row) => row.includes("Summarizing recent trace counts")),
    ).toBe(true);
  });

  it("renders the reply as its own block below the plan card", () => {
    renderMessage(planMessage());
    const reply = screen.getByText(REPLY);
    expect(reply.closest("p")?.textContent).toBe(REPLY);
  });
});

describe("given a completed turn whose only output was reasoning", () => {
  it("renders a thumbs-up instead of an empty reply", () => {
    renderMessage(
      assistantMessage([
        { type: "reasoning", text: "Considering the thanks" },
        { type: "text", text: "", role: "assistant" },
      ]),
    );
    expect(screen.getByRole("img", { name: "Thumbs up" })).toBeInTheDocument();
  });

  it("stays silent while the turn is still streaming", () => {
    const { container } = render(
      <ChakraProvider value={defaultSystem}>
        <MessageContent
          message={assistantMessage([
            { type: "reasoning", text: "Considering the thanks" },
          ])}
          appliedOutcomes={{}}
          discardedProposals={new Set()}
          applyingProposals={new Set()}
          onApply={async () => {}}
          onDiscard={() => {}}
          isStreaming
        />
      </ChakraProvider>,
    );
    expect(container.textContent).not.toContain("👍");
  });
});

describe("given an empty turn that ended in a tool failure", () => {
  it("shows the error card and never the thumbs-up", () => {
    const { container } = renderMessage(
      assistantMessage([
        {
          type: "tool-grep",
          toolCallId: "call-err",
          state: "output-error",
          input: { pattern: "traces" },
          errorText: "grep exploded",
        },
      ]),
    );
    expect(container.textContent).not.toContain("👍");
    expect(screen.queryByRole("img", { name: "Thumbs up" })).toBeNull();
  });
});

describe("given a settled turn with two adjacent text parts", () => {
  it("separates them with a block break instead of gluing", () => {
    const { container } = renderMessage(
      assistantMessage([
        { type: "text", text: "Alpha ends here.", role: "assistant" },
        { type: "text", text: "Beta starts here.", role: "assistant" },
      ]),
    );
    expect(container.textContent).toContain("Alpha ends here.");
    expect(container.textContent).toContain("Beta starts here.");
    expect(container.textContent).not.toContain("here.Beta");
  });
});
