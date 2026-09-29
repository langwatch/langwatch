/**
 * @vitest-environment jsdom
 *
 * The governance chip, held to the two things every page depends on: it reads
 * as "what · which", and it is not a native select.
 *
 * The second is the one worth a test. A native `<select>` is the cheapest way
 * to add a choice to a page and the only one that cannot be styled, so the
 * mistake is not exotic — it is the default. Page suites reuse
 * `findNativeSelects` to make the same assertion about a whole page.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { Building2 } from "lucide-react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MenuItem } from "~/components/ui/menu";

import { FilterChip, FilterChipRow, SortChip } from "../FilterChip";
import { findNativeSelects } from "../noNativeSelect";

const withChakra = (ui: ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);

afterEach(() => cleanup());

describe("the governance filter chip", () => {
  describe("when it renders a choice", () => {
    /** @scenario "A filter chip renders a menu pill rather than a native select" */
    it("renders no native select element", () => {
      const { container } = withChakra(
        <FilterChip
          icon={<Building2 size={12} />}
          label="Department"
          value="All departments"
        >
          <MenuItem value="all">All departments</MenuItem>
        </FilterChip>,
      );

      expect(findNativeSelects(container)).toHaveLength(0);
    });

    /** @scenario "A filter chip names what it filters and the value in view" */
    it("names the filter and the value in view", () => {
      withChakra(
        <FilterChip
          icon={<Building2 size={12} />}
          label="Department"
          value="Engineering"
        >
          <MenuItem value="all">All departments</MenuItem>
        </FilterChip>,
      );

      const chip = screen.getByRole("button");
      expect(chip).toHaveTextContent("Department");
      expect(chip).toHaveTextContent("Engineering");
    });
  });

  describe("when the reader opens it", () => {
    /** @scenario "A filter chip opens its options as a menu" */
    it("offers its options as menu items", async () => {
      const onPick = vi.fn();
      withChakra(
        <FilterChip
          icon={<Building2 size={12} />}
          label="Department"
          value="All departments"
        >
          <MenuItem value="eng" onClick={onPick}>
            Engineering
          </MenuItem>
        </FilterChip>,
      );

      await userEvent.click(screen.getByRole("button"));

      await waitFor(() =>
        expect(screen.getByText("Engineering")).toBeInTheDocument(),
      );
    });
  });

  describe("when its choices cannot apply", () => {
    /** @scenario "A choice that cannot apply is offered as disabled rather than removed" */
    it("stays on screen, disabled", () => {
      withChakra(
        <FilterChip
          icon={<Building2 size={12} />}
          label="Time Interval"
          value="Year"
          disabled
        >
          <MenuItem value="year">Year</MenuItem>
        </FilterChip>,
      );

      expect(screen.getByRole("button")).toBeDisabled();
    });
  });
});

describe("the governance filter row", () => {
  describe("when a page renders filters and sort together", () => {
    /** @scenario "Filters and sort share one row under the page header" */
    it("holds both in a single row and renders no native select", () => {
      const { container } = withChakra(
        <FilterChipRow>
          <FilterChip
            icon={<Building2 size={12} />}
            label="Department"
            value="All departments"
          >
            <MenuItem value="all">All departments</MenuItem>
          </FilterChip>
          <SortChip value="Spend">
            <MenuItem value="spend">Spend</MenuItem>
          </SortChip>
        </FilterChipRow>,
      );

      const chips = screen.getAllByRole("button");
      expect(chips).toHaveLength(2);
      expect(chips[1]).toHaveTextContent("Sort");
      expect(findNativeSelects(container)).toHaveLength(0);
    });
  });
});
