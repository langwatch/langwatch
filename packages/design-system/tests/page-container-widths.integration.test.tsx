// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageLayout } from "../src/components/layout/page-layout.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

const bodyOf = (width: "default" | "fill" | "narrow") => {
  renderWithDesignSystem(
    <PageLayout.Container width={width} data-testid="body">
      <p>content</p>
    </PageLayout.Container>,
  );
  return getComputedStyle(screen.getByTestId("body"));
};

describe("page body widths", () => {
  /** @scenario A narrow page body is one centred reading column */
  it("caps a narrow body at the reading measure plus the page inset, centred", () => {
    const style = bodyOf("narrow");

    expect(style.maxWidth).toContain("900px");
    expect(style.maxWidth).toContain("--page-inset");
    // Chakra writes the logical properties, which is what centres the column in either direction.
    expect(style.getPropertyValue("margin-inline")).toBe("auto");
    expect(style.getPropertyValue("padding-inline")).toContain("--page-inset");
  });

  it("leaves the default and fill bodies without auto margins", () => {
    for (const width of ["default", "fill"] as const) {
      const style = bodyOf(width);
      expect(style.maxWidth, width).not.toContain("900px");
      expect(style.getPropertyValue("margin-inline"), width).toBe("");
      cleanup();
    }
  });
});
