/**
 * @vitest-environment jsdom
 *
 * The live preview must open a card for every opening the grammar accepts
 * (specs/langy/langy-derived-cards.feature). The stream renderer skips the
 * line scan when the text carries no card fence, and that shortcut used to
 * be a substring test written at the call site, spelling the backticks and
 * the tag as one string. The grammar trims the tag, so an opening with a
 * space or an indent in between is a card to the relay and was plain
 * markdown to the browser: the reader watched the closing report of a run
 * arrive as a block of raw JSON, while the recorded conversation held a
 * correct card all along.
 *
 * Boundary mocks: the project hook (deep links) and the tRPC client, which
 * the card view reaches for and neither of these cards uses.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
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
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

import { StreamingAnswerWithCards } from "../components/derived-cards/StreamingAnswerWithCards";

afterEach(cleanup);

const CARD_JSON = JSON.stringify({
  kind: "stats",
  blockId: "winner-margin",
  items: [{ label: "Winner pass rate", value: 100, unit: "%" }],
});

const streamWith = (opening: string): string =>
  ["Version A wins.", opening, CARD_JSON, "```", "Ready to publish."].join(
    "\n",
  );

const renderStream = (text: string) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <StreamingAnswerWithCards text={text} />
    </ChakraProvider>,
  );

describe("StreamingAnswerWithCards", () => {
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

      expect(document.querySelectorAll("[data-derived-by-langy]")).toHaveLength(
        0,
      );
    });
  });
});
