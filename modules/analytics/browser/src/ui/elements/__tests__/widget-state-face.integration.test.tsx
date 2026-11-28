/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { WidgetLoadingFace } from "../widget-state-face.tsx";

afterEach(cleanup);

describe("given a widget whose queries have not answered", () => {
  describe("when the query is not slow yet", () => {
    it("announces loading to screen readers only", () => {
      renderWithDesignSystem(<WidgetLoadingFace slow={false} />);

      expect(screen.getByText("Loading")).toBeInTheDocument();
      expect(screen.queryByText("Slow query, still running…")).toBeNull();
    });
  });

  describe("when it has run for 5 seconds", () => {
    /** @scenario "A widget whose query runs past 5 seconds says it is a slow query" */
    it("says it is a slow query, still running", () => {
      renderWithDesignSystem(<WidgetLoadingFace slow />);

      expect(screen.getByText("Slow query, still running…")).toBeInTheDocument();
    });
  });
});
