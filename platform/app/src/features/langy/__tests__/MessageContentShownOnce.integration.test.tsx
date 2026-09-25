/**
 * @vitest-environment jsdom
 *
 * The panel draws each line once. The rule is applied to the record when a
 * turn finalizes, and again at render: a tab that watched the turn keeps the
 * copy it streamed rather than reading the durable one back, and a turn
 * recorded before the rule existed is read from as it stands.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
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
    useUtils: () => ({}),
    publicEnv: { useQuery: () => ({ data: {} }) },
  },
}));

import { MessageContent } from "../components/MessageContent";

afterEach(cleanup);

const BRANCH =
  "I left branch langy/acme-checkout checked out: the agent you started runs on it.";
const PROPOSAL =
  "The first one I'd write is Guest completes checkout, because it is the golden path.";

function say(text: string, id: string) {
  return {
    type: "tool-say",
    toolCallId: id,
    state: "output-available",
    input: { text },
    output: "Said.",
  };
}

function renderParts(parts: unknown[]) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageContent
        message={{ id: "m1", role: "assistant", parts } as unknown as UIMessage}
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
        isStreaming={false}
        conversationId="langyconv_demo"
      />
    </ChakraProvider>,
  );
}

/**
 * How many times this text is on screen. An element whose child holds the same
 * text is the wrapper of one drawing, not a second, so only the innermost
 * element of each is counted.
 */
function drawn(text: string): number {
  const holders = [...document.querySelectorAll("*")].filter(
    (node) => node.textContent?.trim() === text,
  );
  return holders.filter(
    (node) => !holders.some((other) => other !== node && node.contains(other)),
  ).length;
}

describe("given a turn whose reply text repeats a line it already said", () => {
  it("draws that line once", () => {
    renderParts([
      say(BRANCH, "s1"),
      { type: "text", text: BRANCH, role: "assistant" },
    ]);

    expect(drawn(BRANCH)).toBe(1);
  });
});

describe("given a proposal that was said and then asked on its card", () => {
  it("draws the question once, on the card", () => {
    renderParts([
      say(PROPOSAL, "s1"),
      {
        type: "tool-question",
        toolCallId: "q1",
        state: "output-available",
        input: {
          questions: [
            {
              question: PROPOSAL,
              bare: true,
              options: [
                { label: "Create it" },
                { label: "Chat about this", quiet: true },
              ],
            },
          ],
        },
        output: "answered",
      },
      { type: "text", text: "", role: "assistant" },
    ]);

    expect(drawn(PROPOSAL)).toBe(1);
    expect(screen.getByText("Create it")).toBeTruthy();
  });
});
