/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { Switch } from "../switch.tsx";
import { ToggleRow } from "../toggle-row.tsx";

afterEach(cleanup);

describe("Feature: A standalone on/off setting reads as one bordered row", () => {
  /** @scenario "A toggle row names its setting and steps up its border when on" */
  it("Scenario: A toggle row names its setting and steps up its border when on", () => {
    renderWithDesignSystem(
      <ToggleRow label="Only signed calls" hint="Only real calls" on data-testid="row">
        <Switch aria-label="Only signed calls" checked />
      </ToggleRow>,
    );
    const row = screen.getByTestId("row");
    expect(row).toHaveTextContent("Only signed calls");
    expect(row).toHaveTextContent("Only real calls");
    expect(row).toHaveAttribute("data-on", "true");
    expect(screen.getByRole("checkbox", { name: "Only signed calls" })).toBeChecked();
  });
});
