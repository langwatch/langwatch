/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { Temporal } from "@langwatch/time";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { DateFormats } from "../formatted-date.tsx";
import { NumberFormats } from "../formatted-number.tsx";

afterEach(cleanup);

describe("Feature: hover popovers list a value in every format", () => {
  it("Scenario: a currency lists compact, full and exact forms", () => {
    renderWithDesignSystem(<NumberFormats value={3e9} currency="USD" />);
    const box = screen.getByTestId("number-formats");
    expect(box).toHaveTextContent("Compact");
    expect(box).toHaveTextContent("$3B");
    expect(box).toHaveTextContent("Full");
    expect(box).toHaveTextContent("Exact");
  });

  it("Scenario: a date lists the viewer zone, UTC, source zone, offset and age", () => {
    renderWithDesignSystem(
      <DateFormats
        epochMs={Temporal.Instant.from("2020-01-15T12:00:00Z").epochMilliseconds}
        sourceTimeZone="Asia/Tokyo"
      />,
    );
    const box = screen.getByTestId("date-formats");
    for (const label of ["UTC", "Asia/Tokyo", "Offset", "When"]) {
      expect(box).toHaveTextContent(label);
    }
    expect(box).toHaveTextContent(/ago/);
  });
});
