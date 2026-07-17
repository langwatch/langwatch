/**
 * @vitest-environment jsdom
 *
 * An applied proposal's "Open" affordance points at an in-app destination (a
 * trace, say). A plain click must SPA-navigate — not full-reload — while
 * cmd/ctrl-click keeps opening a new tab natively.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { ProposalCard, type LangyProposal } from "../components/MessageContent";

const proposal: LangyProposal = {
  langyProposal: true,
  kind: "open_trace",
  summary: "Open the trace",
  payload: {},
};

function renderApplied(href: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProposalCard
        proposal={proposal}
        appliedOutcome={{ href, label: "Open trace" }}
        isDiscarded={false}
        isApplying={false}
        onApply={() => {}}
        onDiscard={() => {}}
      />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  pushMock.mockClear();
});

describe("given an applied proposal that opens an in-app trace", () => {
  describe("when the Open link is left-clicked", () => {
    it("SPA-navigates through the router instead of a full reload", () => {
      renderApplied("/my-project/messages/abc123");
      fireEvent.click(screen.getByText("Open trace"));
      expect(pushMock).toHaveBeenCalledWith("/my-project/messages/abc123");
    });
  });

  describe("when the Open link is cmd/ctrl-clicked", () => {
    it("leaves the native new-tab behaviour alone", () => {
      renderApplied("/my-project/messages/abc123");
      fireEvent.click(screen.getByText("Open trace"), { metaKey: true });
      expect(pushMock).not.toHaveBeenCalled();
    });
  });

  describe("when the destination is an external URL", () => {
    it("does not SPA-navigate", () => {
      renderApplied("https://github.com/acme/repo/pull/7");
      fireEvent.click(screen.getByText("Open trace"));
      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
