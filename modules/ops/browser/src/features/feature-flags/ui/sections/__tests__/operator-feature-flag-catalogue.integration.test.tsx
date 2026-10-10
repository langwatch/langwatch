/**
 * @vitest-environment jsdom
 * Product rollouts lead the operator catalogue.
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OperatorFeatureFlagCatalogueView,
  type OperatorFeatureFlagCatalogueRead,
} from "../operator-feature-flag-catalogue.tsx";

const CATALOGUE: OperatorFeatureFlagCatalogueRead = {
  flags: [
    {
      key: "ops_es_trace_processing_killswitch",
      scope: "SYSTEM",
      defaultValue: false,
      description: "Halts trace processing.",
      family: null,
      storedValue: null,
      rules: [],
      envOverride: null,
      effective: false,
      lastEditedBy: null,
      updatedAt: null,
    },
    {
      key: "release_ui_comparison_leaderboard_enabled",
      scope: "PRODUCT",
      defaultValue: false,
      description: "Bradley-Terry leaderboard chart.",
      family: null,
      storedValue: null,
      rules: [],
      envOverride: null,
      effective: false,
      lastEditedBy: null,
      updatedAt: null,
    },
  ],
  families: [],
};

afterEach(cleanup);

function renderView(catalogue: OperatorFeatureFlagCatalogueRead = CATALOGUE) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <OperatorFeatureFlagCatalogueView
        catalogue={catalogue}
        canManage={true}
        onSetEnabled={vi.fn()}
        onClear={vi.fn()}
        onSetRules={vi.fn()}
      />
    </DesignSystemProvider>,
  );
}

describe("given an operator opens the feature flags page", () => {
  /** @scenario The page leads with the flags operators actually roll out */
  it("shows the Product section before the System section", () => {
    renderView();

    const product = screen.getByRole("heading", { name: "Product" });
    const system = screen.getByRole("heading", { name: "System" });

    // DOCUMENT_POSITION_FOLLOWING: `system` comes after `product` in the
    // document, which is the reading order on the page.
    expect(product.compareDocumentPosition(system) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers targeting as an icon button beside each toggle, not a text link", () => {
    renderView();

    expect(screen.getAllByRole("button", { name: "Specific targeting" })).toHaveLength(2);
    expect(screen.queryByText(/^Target \(/)).toBeNull();
  });

  it("prints the last edit day first, whatever the browser locale", () => {
    const flags = CATALOGUE.flags.map((flag, index) =>
      index === 0 ? { ...flag, storedValue: true, updatedAt: "2026-08-26T12:00:00.000Z" } : flag,
    );
    renderView({ ...CATALOGUE, flags });

    expect(screen.getByText(/^26\/08\/2026 \d{2}:\d{2}:\d{2}$/)).toBeTruthy();
  });
});

describe("given an operator searches the catalogue", () => {
  it("finds a flag by its explanation and restores the catalogue when cleared", () => {
    renderView();
    const search = screen.getByRole("searchbox", { name: "Search feature flags" });
    fireEvent.change(search, { target: { value: "halts" } });
    expect(screen.getByText("ops_es_trace_processing_killswitch")).toBeTruthy();
    expect(screen.queryByText("release_ui_comparison_leaderboard_enabled")).toBeNull();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByText("release_ui_comparison_leaderboard_enabled")).toBeTruthy();
  });

  it("shows empty states when neither scope matches", () => {
    renderView();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search feature flags" }), {
      target: { value: "unregistered flag" },
    });
    expect(screen.getAllByText("No matching flags")).toHaveLength(2);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
