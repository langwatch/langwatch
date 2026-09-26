/**
 * @vitest-environment jsdom
 *
 * The latency chip must pin the "how-do-i" skill on the turn it sends, so the
 * agent cannot silently skip loading the skill on a text-only prompt (it did,
 * live, on gpt-5-mini). This is the click-time half of that contract: the
 * unit suite (langyHomeSuggestions.unit.test.ts) pins the DATA (the
 * suggestion carries `skill: "how-do-i"`); this pins that clicking the row
 * actually forwards it to `onPick`.
 *
 * Spec: specs/langy/langy-how-do-i-latency.feature
 *
 * No mocks: EmptyState has no boundary to mock — it's rendered directly under
 * a bare ChakraProvider, same pattern the other Langy component tests use.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmptyState, SUGGESTIONS } from "../components/EmptyState";

afterEach(() => {
  cleanup();
});

function renderEmptyState(
  onPick: (prompt: string, options?: { skill?: string }) => void,
) {
  render(
    <ChakraProvider value={defaultSystem}>
      <EmptyState onPick={onPick} suggestions={SUGGESTIONS} />
    </ChakraProvider>,
  );
}

describe("EmptyState", () => {
  describe("when the reader clicks the latency chip", () => {
    /** @scenario "The empty state offers the latency question" */
    it("calls onPick with the how-do-i skill pinned", async () => {
      const onPick = vi.fn();
      renderEmptyState(onPick);
      const user = userEvent.setup();

      await user.click(
        screen.getByText("How do I improve my agent's latency?"),
      );

      expect(onPick).toHaveBeenCalledWith(
        "How do I improve my agent's latency?",
        { skill: "how-do-i" },
      );
    });
  });

  describe("when the reader clicks a chip with no skill", () => {
    it("calls onPick with no skill option", async () => {
      const onPick = vi.fn();
      renderEmptyState(onPick);
      const user = userEvent.setup();

      await user.click(screen.getByText("Find failing traces"));

      const [, options] = onPick.mock.calls[0]!;
      expect(options?.skill).toBeUndefined();
    });
  });
});
