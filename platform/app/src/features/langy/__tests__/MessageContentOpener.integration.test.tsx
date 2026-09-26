/**
 * @vitest-environment jsdom
 *
 * The guided opener is a turn of two calls: one `say` and one `code_access`.
 * Nothing else runs, so there is no activity, no proposal and no prose part,
 * and the turn rendered as "No content" with the card swallowed: the take
 * stood at the empty panel until it timed out waiting for the card's own
 * options.
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

const OPENER =
  "Ok, let's set up your agent with LangWatch. Can I access your code?";

/** The opener exactly as the control plane stores it. */
function openerParts(): unknown[] {
  return [
    {
      type: "tool-say",
      toolCallId: "call_say",
      state: "output-available",
      input: { text: OPENER },
      output: "Said.",
    },
    {
      type: "tool-code_access",
      toolCallId: "call_code_access",
      state: "output-available",
      input: {
        reason:
          "wire tracing in and write the first scenario against your agent",
        offer_describe: true,
      },
      output: "The code access card is shown to the user.",
    },
    { type: "text", text: "", role: "assistant" },
  ];
}

function renderOpener() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageContent
        message={
          {
            id: "m-opener",
            role: "assistant",
            parts: openerParts(),
          } as unknown as UIMessage
        }
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

describe("given the guided opener, a said line and the code access card", () => {
  it("draws the line Langy said", () => {
    renderOpener();

    const blocks = [
      ...document.querySelectorAll("[data-langy-say] > *"),
    ].filter((block) => block.textContent?.includes(OPENER));
    expect(blocks.length).toBeGreaterThan(0);
  });

  it("never reads as an empty turn", () => {
    renderOpener();

    expect(screen.queryByText("No content")).toBeNull();
  });
});
