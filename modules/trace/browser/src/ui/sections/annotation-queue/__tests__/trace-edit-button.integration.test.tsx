/**
 * @vitest-environment jsdom
 * Trace's Edit trace, lent to the queue walker: it opens the trace drawer on
 * the queued trace, already editing, and never on the conversation tab.
 * @see specs/annotations/annotation-queue-workflow.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDrawerStore } from "../../../../behavior/drawer.store.ts";
import { TraceEditButton } from "../trace-edit-button.tsx";

const mocks = vi.hoisted(() => ({ openDrawer: vi.fn() }));

vi.mock("../../../../behavior/use-drawer.ts", () => ({
  useDrawer: () => ({ openDrawer: mocks.openDrawer }),
}));

function renderButton() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TraceEditButton traceId="trace-1" occurredAtMs={1_700_000_000_000} />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("when the reviewer chooses Edit trace", () => {
  /** @scenario "Edit trace opens the trace drawer already in annotation mode" */
  it("opens the trace drawer on that trace, already editing", async () => {
    renderButton();

    await userEvent.click(screen.getByRole("button", { name: "Edit trace" }));

    expect(mocks.openDrawer).toHaveBeenCalledWith("traceV2Details", {
      traceId: "trace-1",
      t: "1700000000000",
      urlParams: { edit: "1" },
    });
  });

  describe("given the drawer last showed the conversation tab", () => {
    /** @scenario "Edit trace falls back from the conversation tab to the summary tab" */
    it("opens the drawer on the summary tab instead", async () => {
      useDrawerStore.setState({ viewMode: "conversation" });
      renderButton();

      await userEvent.click(screen.getByRole("button", { name: "Edit trace" }));

      expect(useDrawerStore.getState().viewMode).toBe("summary");
    });
  });
});
