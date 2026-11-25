// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The generic Sources table leaves Security Lake sources to their own section,
 * so its edit drawer cannot overwrite a Security Lake source's config.
 *
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import "@testing-library/jest-dom/vitest";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CONNECTED_SOURCES, harness, openTab, renderScreen } from "./inventoryScreenHarness";

const SECURITY_LAKE_SOURCE = {
  ...CONNECTED_SOURCES[0]!,
  id: "src-lake",
  name: "Lake CloudTrail feed",
  sourceType: "security_lake",
  parserConfig: { region: "eu-west-1", queueUrl: "https://sqs.eu-west-1.amazonaws.com/1/q" },
};

describe("given an admin on the Inventory page with a Security Lake source", () => {
  describe("when the Sources pane opens", () => {
    /** @scenario "The generic sources list leaves Security Lake sources to their own section" */
    it("lists the other sources in the generic table and not the Security Lake one", async () => {
      harness.sources = {
        data: [...CONNECTED_SOURCES, SECURITY_LAKE_SOURCE],
        isLoading: false,
        error: null,
      };
      renderScreen();
      await openTab(/Sources/);

      const table = (await screen.findByText("Warehouse questions")).closest("table");
      expect(table).not.toBeNull();
      expect(within(table!).getByText("Assistant transcripts")).toBeInTheDocument();
      expect(within(table!).queryByText("Lake CloudTrail feed")).not.toBeInTheDocument();
    });
  });
  describe("when the only source is a Security Lake one", () => {
    /** @scenario "The generic sources list leaves Security Lake sources to their own section" */
    it("does not say no sources are connected", async () => {
      harness.sources = { data: [SECURITY_LAKE_SOURCE], isLoading: false, error: null };
      renderScreen();
      await openTab(/Sources/);

      expect(screen.queryByText("No sources connected yet")).not.toBeInTheDocument();
    });
  });
});
