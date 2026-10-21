/**
 * Real-Chromium layout of a condition chip in a narrow container: jsdom lays
 * nothing out, so only a browser can say the label stays inside the border.
 * @see specs/automations/list-pages.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FilterDisplay } from "../filter-display.tsx";

afterEach(cleanup);

const MONITOR_ID = "monitor_0008KDW6ykSweqn6dwR0UukEOi2wAbCdEfGhIjKlMnOpQrSt";

const renderNarrow = (filters: Record<string, unknown>) => {
  renderWithDesignSystem(
    <div data-testid="frame" style={{ width: "320px" }}>
      <FilterDisplay filters={filters} hasBorder={true} shouldClampValues={false} />
    </div>,
  );
  return screen.getByTestId("frame").getBoundingClientRect();
};

const boxOf = (text: string | RegExp) => screen.getByText(text).getBoundingClientRect();

describe("given a condition keyed by one long unbreakable monitor id", () => {
  /** @scenario "A long key wraps inside its filter chip" */
  it("keeps the label inside the chip and puts the value on its own line", async () => {
    const frame = renderNarrow({ "evaluations.passed": { [MONITOR_ID]: ["0", "false"] } });

    await expect.poll(() => boxOf(new RegExp(MONITOR_ID)).right).toBeLessThanOrEqual(frame.right);
    const label = boxOf(new RegExp(MONITOR_ID));
    const value = boxOf("0, false");
    expect(label.left).toBeGreaterThanOrEqual(frame.left);
    expect(value.right).toBeLessThanOrEqual(frame.right);
    expect(value.top).toBeGreaterThanOrEqual(label.bottom - 1);
    // One line tall: the value is no longer squeezed to a character per line.
    expect(value.height).toBeLessThan(label.height);
  });
});

describe("given a short key and value that fit side by side", () => {
  it("keeps them on one line", async () => {
    renderNarrow({ "metadata.value": { plan: ["true"] } });

    await expect.poll(() => boxOf("true").top).toBe(boxOf("Metadata · plan").top);
  });
});
