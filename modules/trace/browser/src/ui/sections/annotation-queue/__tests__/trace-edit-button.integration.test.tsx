/**
 * @vitest-environment jsdom
 * Trace's Edit trace, lent to the queue walker: it opens the trace drawer on
 * the queued trace, already editing, and never on the conversation tab.
 * @see modules/annotation/specs/annotation-queue-workflow.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { drawerChrome } from "../../../../behavior/drawer-chrome.store.ts";
import { TraceEditButton } from "../trace-edit-button.tsx";

const mocks = vi.hoisted(() => ({ openDrawer: vi.fn() }));

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: mocks.openDrawer }),
}));

function renderButton() {
  return renderWithDesignSystem(
    <TraceEditButton traceId="trace-1" occurredAtMs={1_700_000_000_000} />,
  );
}

afterEach(() => {
  drawerChrome.setState(drawerChrome.getInitialState(), true);
  cleanup();
  vi.clearAllMocks();
});

describe("when the reviewer chooses Edit trace", () => {
  /** @scenario "Edit trace uses the trace drawer in annotation mode" */
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
    /** @scenario "Edit trace uses the trace drawer in annotation mode" */
    it("opens the drawer on the summary tab instead", async () => {
      drawerChrome.getState().rememberViewMode("conversation");
      renderButton();

      await userEvent.click(screen.getByRole("button", { name: "Edit trace" }));

      expect(mocks.openDrawer).toHaveBeenCalledWith(
        "traceV2Details",
        expect.objectContaining({ mode: "summary" }),
      );
    });
  });
});
