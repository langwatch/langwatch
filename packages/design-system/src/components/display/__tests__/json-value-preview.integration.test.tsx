/** @vitest-environment jsdom */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { JsonValuePreview } from "../json-value-preview.tsx";

afterEach(cleanup);
describe("live JSON values", () => {
  it("marks changed and added fields while retaining unchanged context", () => {
    renderWithDesignSystem(
      <JsonValuePreview
        previousData={{ pending: 12, healthy: true }}
        data={{ pending: 8, healthy: true, revision: 42 }}
      />,
    );
    const changes = screen.getAllByTitle("Changed since previous snapshot");
    expect(changes.map((line) => line.textContent?.trim())).toEqual([
      '"pending": 8,',
      '"revision": 42',
    ]);
    expect(
      screen.getByText("true").closest('[title="Changed since previous snapshot"]'),
    ).toBeNull();
  });
  it("renders a first snapshot and empty containers without inventing changes", () => {
    renderWithDesignSystem(<JsonValuePreview data={{ object: {}, array: [], value: null }} />);
    expect(screen.getByText("{}")).toBeTruthy();
    expect(screen.getByText("[]")).toBeTruthy();
    expect(screen.getByText("null")).toBeTruthy();
    expect(screen.queryByTitle("Changed since previous snapshot")).toBeNull();
  });
});
