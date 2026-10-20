/**
 * A dialog's title takes the frame's width up to the X, and its description sits under it.
 * Measured in real Chromium, which jsdom cannot lay out.
 * @see packages/design-system/specs/dialog-title-width.feature
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Dialog } from "../../src/components/overlays/views/dialog-view.tsx";
import { renderWithDesignSystem } from "../../src/testing/index.tsx";

afterEach(cleanup);

function openDialog({ title, description }: { title: string; description: string }) {
  renderWithDesignSystem(
    <Dialog
      open
      onClose={() => undefined}
      title={title}
      description={description}
      primaryAction={{ label: "Revoke key", onClick: () => undefined }}
      data-testid="dialog"
    />,
  );
}

function part({ name }: { name: string }): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-scope="dialog"][data-part="${name}"]`);
  if (!found) throw new Error(`no dialog ${name}`);
  return found;
}

const lines = ({ element }: { element: HTMLElement }) =>
  Math.round(
    element.getBoundingClientRect().height /
      Number.parseFloat(getComputedStyle(element).lineHeight),
  );

describe("dialog title width", () => {
  /** @scenario A dialog title takes the width up to the X and its description sits under it */
  it("keeps a four word title on one line, clear of the X, with the description under it", async () => {
    openDialog({
      title: "Revoke Production support key?",
      description: "Clients using this key start receiving 401s within about a minute.",
    });
    await screen.findByTestId("dialog");

    await waitFor(() => {
      const title = part({ name: "title" });
      const description = part({ name: "description" });
      const close = screen.getByTestId("dialog-close").getBoundingClientRect();
      const t = title.getBoundingClientRect();
      const frame = screen.getByTestId("dialog").getBoundingClientRect();
      expect(lines({ element: title })).toBe(1);
      expect(t.right).toBeLessThanOrEqual(close.left);
      expect(t.left - frame.left).toBe(25);
      expect(description.getBoundingClientRect().top).toBeGreaterThanOrEqual(t.bottom);
      expect(description.getBoundingClientRect().left).toBe(t.left);
    });
  });

  /** @scenario A dialog title takes the width up to the X and its description sits under it */
  it("wraps a very long title across the whole frame, not a narrow column", async () => {
    openDialog({
      title: "Revoke the Production support key used by the payments gateway in Frankfurt?",
      description: "Clients using this key start receiving 401s within about a minute.",
    });
    await screen.findByTestId("dialog");

    await waitFor(() => {
      const title = part({ name: "title" });
      const frame = screen.getByTestId("dialog").getBoundingClientRect();
      const close = screen.getByTestId("dialog-close").getBoundingClientRect();
      expect(lines({ element: title })).toBeLessThanOrEqual(3);
      expect(title.getBoundingClientRect().width).toBeGreaterThan(frame.width / 2);
      expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(close.left);
    });
  });
});
