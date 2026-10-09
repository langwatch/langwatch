// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The two derivation rules the page test cannot see, because both are about
 * source lists a real organization would have to be contrived into: one
 * environment behind two sources, and a source that names none.
 *
 * Rendered rather than asserted against `discoverEnvironments` directly: the
 * claim is about what a reader counts on screen, and a derivation that
 * de-duplicated correctly into a table that rendered both would still be the
 * bug.
 *
 * Spec: specs/ai-governance/dashboard/inventory-environments.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import type { EnvironmentSource } from "../discoveredEnvironments";
import { EnvironmentsTab } from "../EnvironmentsTab";

function source(overrides: Partial<EnvironmentSource>): EnvironmentSource {
  return {
    id: "src",
    name: "A source",
    sourceType: "copilot_studio_dataverse",
    parserConfig: {},
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function renderTab(sources: EnvironmentSource[]) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EnvironmentsTab sources={sources} sampleActive={false} added={[]} />
    </ChakraProvider>,
  );
}

describe("given sources that name environments", () => {
  describe("when two of them point at the same address", () => {
    /** @scenario "Two sources pointed at one environment are one row" */
    it("lists one row for that environment", () => {
      renderTab([
        source({
          id: "a",
          name: "First",
          parserConfig: { environmentUrl: "https://one.crm.test" },
        }),
        source({
          id: "b",
          name: "Second",
          // The same environment, written with a trailing slash.
          parserConfig: { environmentUrl: "https://one.crm.test/" },
        }),
      ]);
      const table = screen.getByTestId("environments-table");
      expect(within(table).getAllByText("one.crm.test")).toHaveLength(1);
    });
  });

  describe("when a source names no environment", () => {
    /** @scenario "A source type that names no environment contributes no row" */
    it("contributes no row", () => {
      renderTab([
        source({
          id: "a",
          name: "Pushes telemetry",
          sourceType: "claude_code",
          parserConfig: {},
        }),
        source({
          id: "b",
          name: "Mid-configuration",
          parserConfig: { environmentUrl: "   " },
        }),
      ]);
      expect(screen.queryByTestId("environments-table")).toBeNull();
      expect(
        screen.getByText(/appear here once a source points at one/i),
      ).toBeInTheDocument();
    });
  });
});
