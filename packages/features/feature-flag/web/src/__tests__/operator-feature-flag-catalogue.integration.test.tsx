/**
 * Which section an operator lands on first: a product rollout is the daily
 * reason to open this page, and a kill switch is the exception, so Product
 * leads.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { OperatorFeatureFlagCatalogue } from "@langwatch/feature-flag-contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperatorFeatureFlagCatalogueView } from "../operator-feature-flag-catalogue";

const CATALOGUE: OperatorFeatureFlagCatalogue = {
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

function renderView() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <OperatorFeatureFlagCatalogueView
        catalogue={CATALOGUE}
        canManage={true}
        onSetEnabled={vi.fn()}
        onClear={vi.fn()}
        onSetRules={vi.fn()}
      />
    </ChakraProvider>,
  );
}

describe("given an operator opens the feature flags page", () => {
  /** @scenario The page leads with the flags operators actually roll out */
  it("shows the Product section before the System section", () => {
    renderView();

    const product = screen.getByText("Product");
    const system = screen.getByText("System");

    // DOCUMENT_POSITION_FOLLOWING: `system` comes after `product` in the
    // document, which is the reading order on the page.
    expect(product.compareDocumentPosition(system) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
