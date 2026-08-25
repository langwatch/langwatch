// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ColumnTypeIcon } from "../src/components/column-type-icon";

describe("ColumnTypeIcon", () => {
  /** @scenario Shared table headers retain their type-specific visual cues */
  it("renders the mapped icon and colour for a known column type", () => {
    const { container } = render(<ColumnTypeIcon type="boolean" size={14} />);
    const icon = container.querySelector("svg");

    expect(icon?.getAttribute("stroke")).toBe("var(--chakra-colors-teal-500)");
    expect(icon?.getAttribute("width")).toBe("16");
    expect(icon?.querySelectorAll("circle")).toHaveLength(1);
    expect(icon?.querySelectorAll("rect")).toHaveLength(1);
  });

  /** @scenario New column types retain a readable generic icon */
  it("uses the neutral text icon for an unknown column type", () => {
    const { container } = render(<ColumnTypeIcon type="custom" />);
    const icon = container.querySelector("svg");

    expect(icon?.getAttribute("stroke")).toBe("var(--chakra-colors-gray-400)");
    expect(icon?.querySelectorAll("circle")).toHaveLength(0);
  });
});
