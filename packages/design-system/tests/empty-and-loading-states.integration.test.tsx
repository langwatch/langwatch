// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Button } from "@chakra-ui/react";
import { cleanup, screen } from "@testing-library/react";
import { Database } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsEmptyState } from "../src/components/layout/settings-section.tsx";
import { ChartEmptyState } from "../src/components/states/chart-empty-state.tsx";
import { NoDataInfoBlock } from "../src/components/states/no-data-info-block.tsx";
import { SkeletonCard, SkeletonRows } from "../src/components/states/skeletons.tsx";
import { EmptyValue } from "../src/components/values/empty-value.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

describe("empty and loading states", () => {
  describe("given a primary action and a docs link", () => {
    it("renders the action and a docs link that opens in a new tab", () => {
      renderWithDesignSystem(
        <NoDataInfoBlock
          icon={<Database />}
          title="No datasets yet"
          description="Datasets hold examples."
          primaryAction={<Button>Create a dataset</Button>}
          docsHref="https://langwatch.ai/docs"
        />,
      );

      expect(screen.getByRole("button", { name: "Create a dataset" })).toBeInTheDocument();
      const docs = screen.getByRole("link", { name: /Read the docs/ });
      expect(docs).toHaveAttribute("target", "_blank");
    });
  });

  describe("given the old children prop", () => {
    it("still renders them", () => {
      renderWithDesignSystem(
        <NoDataInfoBlock icon={<Database />} title="Empty" description="Nothing.">
          <Button>Legacy action</Button>
        </NoDataInfoBlock>,
      );

      expect(screen.getByRole("button", { name: "Legacy action" })).toBeInTheDocument();
    });
  });

  describe("given SettingsEmptyState", () => {
    it("renders the inline empty state", () => {
      renderWithDesignSystem(
        <SettingsEmptyState
          icon={<Database />}
          title="No passkeys yet"
          description="Add one."
          data-testid="empty"
        />,
      );

      expect(screen.getByTestId("empty")).toHaveAttribute("data-size", "inline");
    });
  });

  describe("given a chart with no data", () => {
    it("says so with the default title", () => {
      renderWithDesignSystem(<ChartEmptyState />);

      expect(screen.getByText("No data for this period")).toBeInTheDocument();
    });
  });

  describe("given content that is loading", () => {
    it("marks skeletons busy and names them for screen readers", () => {
      renderWithDesignSystem(
        <>
          <SkeletonRows rows={3} label="Loading members" />
          <SkeletonCard label="Loading plan" />
        </>,
      );

      expect(screen.getByTestId("skeleton-rows")).toHaveAttribute("aria-busy", "true");
      expect(screen.getByText("Loading members")).toBeInTheDocument();
      expect(screen.getByText("Loading plan")).toBeInTheDocument();
    });
  });

  describe("given a missing value", () => {
    it("shows an em dash and reads its label", () => {
      renderWithDesignSystem(<EmptyValue label="Never run" />);

      expect(screen.getByText("—")).toHaveAttribute("aria-hidden");
      expect(screen.getByText("Never run")).toBeInTheDocument();
    });
  });
});
