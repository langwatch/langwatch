// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/** The Costs filter row: the two time chips sit beside the department chip and disable what cannot apply. */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../../testing.tsx";
import { CostFilterBar } from "../cost-filter-bar.tsx";

afterEach(cleanup);

function renderBar({ frame }: { frame: "last_3_months" | "last_12_months" }) {
  return renderWithGovernanceHost(
    <CostFilterBar
      departmentName={null}
      departments={[{ id: "dept_eng", name: "Engineering" }]}
      onDepartmentChange={vi.fn()}
      frame={frame}
      onFrameChange={vi.fn()}
      interval="quarter"
      onIntervalChange={vi.fn()}
    />,
    { host: fakeGovernanceHost() },
  );
}

const chip = (label: string) => {
  const found = screen.getAllByRole("button").find((b) => b.textContent?.startsWith(label));
  if (!found) throw new Error(`no ${label} chip`);
  return found;
};

describe("given a page offering both time controls", () => {
  /** @scenario "Time Frame and Time Interval are chips in the same row as the other filters" */
  it("draws both as chips beside the department chip, one reading how far back and one how wide", () => {
    const { container } = renderBar({ frame: "last_12_months" });

    const chips = screen.getAllByRole("button");
    expect(chips.map((b) => b.textContent)).toEqual([
      "Department·All departments",
      "Time Frame·Last 12 months",
      "Time Interval·Quarter",
    ]);
    expect(chips[0]?.parentElement).toBe(chips[1]?.parentElement);
    expect(chips[1]?.parentElement).toBe(chips[2]?.parentElement);
    expect(container.querySelector("select")).toBeNull();
  });
});

describe("given the Time Frame is Last 3 months", () => {
  /** @scenario "An interval coarser than the frame is disabled" */
  it("offers Year disabled and Month available when the interval chip opens", async () => {
    renderBar({ frame: "last_3_months" });

    await userEvent.click(chip("Time Interval"));

    const year = await screen.findByRole("menuitem", { name: "Year" });
    expect(year).toHaveAttribute("aria-disabled", "true");
    const month = screen.getByRole("menuitem", { name: "Month" });
    expect(month).not.toHaveAttribute("aria-disabled", "true");
    expect(
      within(month.closest("[role=menu]") ?? document.body).getAllByRole("menuitem"),
    ).toHaveLength(3);
  });
});
