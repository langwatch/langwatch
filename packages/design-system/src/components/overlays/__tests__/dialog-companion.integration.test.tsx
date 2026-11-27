/**
 * @vitest-environment jsdom
 * @see packages/design-system/adrs/002-overlay-and-card-shapes.md
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { DIALOG_COMPANION_ATTR, Dialog } from "../dialog.tsx";
import { Drawer } from "../drawer.tsx";

/** Past the frame an overlay waits before it hides, traps or listens outside itself. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

afterEach(cleanup);

describe("given a companion dialog is open", () => {
  it("leaves a drawer opened over it non-modal: the companion stays reachable and keeps focus", async () => {
    const user = userEvent.setup();
    const onCloseTraffic = vi.fn();
    renderWithDesignSystem(
      <>
        <aside {...{ [DIALOG_COMPANION_ATTR]: "" }}>
          <button type="button">Ask</button>
        </aside>
        <Dialog open companion onClose={onCloseTraffic} title="Traffic">
          chart
        </Dialog>
        <Drawer onClose={vi.fn()} title="Trace">
          trace
        </Drawer>
      </>,
    );
    await screen.findByRole("dialog", { name: "Trace" });
    await settle();

    // A modal drawer would hide the companion from the accessibility tree and pull focus back.
    const ask = screen.getByRole("button", { name: "Ask" });
    await user.click(ask);
    await settle();

    expect(ask).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Traffic" })).toBeInTheDocument();
    expect(onCloseTraffic).not.toHaveBeenCalled();
  });
});
