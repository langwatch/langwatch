// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";

afterEach(cleanup);

import { Badge } from "@chakra-ui/react";

import { SummaryList, SummaryListItem } from "../summary-list.tsx";

describe("SummaryList", () => {
  /** @scenario "Summary values preserve content and explain absence" */
  it("renders semantic pairs, dashes for absent values and preserves zero and chips", () => {
    const { container } = renderWithDesignSystem(
      <SummaryList>
        <SummaryListItem label="Missing" />
        <SummaryListItem label="Null">{null}</SummaryListItem>
        <SummaryListItem label="Empty">{""}</SummaryListItem>
        <SummaryListItem label="Members">{0}</SummaryListItem>
        <SummaryListItem label="Policy">
          <Badge>Administrator approval</Badge>
        </SummaryListItem>
      </SummaryList>,
    );
    expect(container.querySelector("dl")).toBeInTheDocument();
    expect(screen.getAllByRole("term").map((node) => node.textContent)).toEqual([
      "Missing",
      "Null",
      "Empty",
      "Members",
      "Policy",
    ]);
    expect(screen.getAllByRole("definition").map((node) => node.textContent)).toEqual([
      "—",
      "—",
      "—",
      "0",
      "Administrator approval",
    ]);
  });
});
