/**
 * @vitest-environment jsdom
 *
 * The in-progress capability shell, and what it says once the turn is over.
 *
 * A tool part is only ever closed by its own output, so a turn the user stopped
 * leaves its open call in the running state for good. The card that drew that
 * call kept saying "Searching traces…" with a live pulse for the rest of the
 * conversation, which claimed work that nothing was doing. Interrupted, it
 * keeps the rows it did find and states what happened to it.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../behavior/use-capability-data", () => ({
  useCapabilityData: () => ({ rows: [], loadedCount: 0, totalCount: null }),
}));

import { LangyCapabilityPendingCard } from "../langy-capability-pending-card";

afterEach(cleanup);

function renderCard({ interrupted }: { interrupted: boolean }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyCapabilityPendingCard
        surface="traces"
        overline="Traces"
        headline="Searching traces"
        detail="langwatch trace search --origin application"
        interrupted={interrupted}
      />
    </ChakraProvider>,
  );
}

describe("given a capability call drawn as the in-progress shell", () => {
  describe("when the turn is still running", () => {
    it("says what it is doing, in the present tense", () => {
      const { container } = renderCard({ interrupted: false });

      expect(container.textContent).toContain("Searching traces…");
      expect(container.textContent).not.toContain("Interrupted");
    });
  });

  describe("when the turn ended with the call still open", () => {
    /** @scenario A call left open by a stopped turn reads as interrupted */
    it("drops the present tense and says it was interrupted", () => {
      const { container } = renderCard({ interrupted: true });

      expect(container.textContent).not.toContain("Searching traces…");
      expect(screen.getByText("Searching traces")).toBeTruthy();
      expect(screen.getByText("Interrupted before it finished")).toBeTruthy();
    });
  });
});
