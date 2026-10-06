// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/** The one shape a governance choice takes: a pill that names what it filters and opens a menu. */
import { MenuItem } from "@langwatch/design-system/menu";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Building2 } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";

import {
  fakeGovernanceHost,
  findNativeSelects,
  renderWithGovernanceHost,
} from "../../../testing.tsx";
import { FilterChip, FilterChipRow, SortChip } from "../governance-filter-chip.tsx";

afterEach(cleanup);

const renderChip = ({ disabled }: { disabled?: boolean } = {}) =>
  renderWithGovernanceHost(
    <FilterChipRow>
      <FilterChip
        icon={<Building2 size={12} />}
        label="Department"
        value="Engineering"
        disabled={disabled}
      >
        <MenuItem value="engineering">Engineering</MenuItem>
      </FilterChip>
      <SortChip value="Spend">
        <MenuItem value="spend">Spend</MenuItem>
      </SortChip>
    </FilterChipRow>,
    { host: fakeGovernanceHost() },
  );

describe("given a department chip with Engineering selected", () => {
  /** @scenario "A filter chip renders a menu pill rather than a native select" */
  it("renders a pill button that opens a menu and no native select", () => {
    const { container } = renderChip();

    expect(screen.getByRole("button", { name: /Department/ })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
    expect(findNativeSelects(container)).toEqual([]);
  });

  /** @scenario "A filter chip names what it filters and the value in view" */
  it("reads as the name of the filter followed by the value in view, neither abbreviated", () => {
    renderChip();

    expect(screen.getByRole("button", { name: /Department/ })).toHaveTextContent(
      "Department·Engineering",
    );
  });

  /** @scenario "A filter chip opens its options as a menu" */
  it("offers the department as a menu item when opened", async () => {
    renderChip();

    await userEvent.click(screen.getByRole("button", { name: /Department/ }));

    expect(await screen.findByRole("menuitem", { name: "Engineering" })).toBeInTheDocument();
  });
});

describe("given a chip whose choices cannot apply to the current view", () => {
  /** @scenario "A choice that cannot apply is offered as disabled rather than removed" */
  it("stays on screen, disabled", () => {
    renderChip({ disabled: true });

    expect(screen.getByRole("button", { name: /Department/ })).toBeDisabled();
  });
});

describe("given a page with a department filter and a sort control", () => {
  /** @scenario "Filters and sort share one row under the page header" */
  it("draws both chips as children of the same row, which wraps rather than scrolls", () => {
    renderChip();

    const department = screen.getByRole("button", { name: /Department/ });
    const sort = screen.getByRole("button", { name: /Sort/ });
    expect(department.parentElement).toBe(sort.parentElement);
    const row = getComputedStyle(department.parentElement as HTMLElement);
    expect(row.flexWrap).toBe("wrap");
    expect(["", "visible"]).toContain(row.overflowX);
  });
});
