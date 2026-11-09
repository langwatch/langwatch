/**
 * A one-line empty state quoting a long unbroken search keeps its action inside a narrow list.
 * Measured in real Chromium, which jsdom cannot lay out.
 * @see packages/design-system/specs/empty-next-steps.feature
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NoDataInfoBlock } from "../../src/components/states/no-data-info-block.tsx";
import { renderWithDesignSystem } from "../../src/testing/index.tsx";

afterEach(cleanup);

describe("one-line empty state in a narrow list", () => {
  /** @scenario A one-line sentence that is one long word wraps and keeps its action in view */
  it("wraps the sentence and keeps the action inside the list", async () => {
    const query = "averyveryverylongorganizationnamewithoutanyspacesatallthatkeepsgoing";
    renderWithDesignSystem(
      <div data-testid="list" style={{ width: "332px", overflowY: "auto" }}>
        <NoDataInfoBlock
          size="line"
          title={`No organization matches "${query}".`}
          action={{ label: "Clear search", onClick: () => undefined }}
        />
      </div>,
    );

    const list = (await screen.findByTestId("list")).getBoundingClientRect();
    const action = screen.getByRole("button", { name: "Clear search" }).getBoundingClientRect();
    const sentence = screen.getByText(/No organization matches/).getBoundingClientRect();

    expect(action.right).toBeLessThanOrEqual(list.right);
    expect(action.left).toBeGreaterThanOrEqual(list.left);
    expect(sentence.right).toBeLessThanOrEqual(action.left);
    expect(screen.getByTestId("list").scrollWidth).toBeLessThanOrEqual(332);
  });
});
