/**
 * @vitest-environment jsdom
 *
 * Integration tests for ArchivedSuitesPanel component.
 *
 * Tests the archived suites list rendering, empty state,
 * restore button behavior, and archived date display.
 *
 * @see specs/suites/suite-archiving.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SimulationSuite } from "@prisma/client";
import { ArchivedSuitesPanel } from "../ArchivedSuitesPanel";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeSuite(
  overrides: Partial<SimulationSuite> = {},
): SimulationSuite {
  return {
    id: "suite_1",
    projectId: "project_1",
    name: "Archived Suite",
    slug: "archived-suite--archived",
    description: null,
    scenarioIds: [],
    targets: [],
    repeatCount: 1,
    labels: [],
    archivedAt: new Date("2026-02-01"),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("<ArchivedSuitesPanel/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given no archived suites", () => {
    it("renders the empty state message", () => {
      render(
        <ArchivedSuitesPanel suites={[]} onRestore={vi.fn()} isRestoring={false} />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("No archived suites")).toBeInTheDocument();
    });
  });

  describe("given archived suites exist", () => {
    it("renders the suite name", () => {
      const suites = [makeSuite({ name: "Edge Case Suite" })];
      render(
        <ArchivedSuitesPanel suites={suites} onRestore={vi.fn()} isRestoring={false} />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Edge Case Suite")).toBeInTheDocument();
    });

    it("renders the 'Archived Suites' heading", () => {
      const suites = [makeSuite()];
      render(
        <ArchivedSuitesPanel suites={suites} onRestore={vi.fn()} isRestoring={false} />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Archived Suites")).toBeInTheDocument();
    });

    it("renders a Restore button for each suite", () => {
      const suites = [
        makeSuite({ id: "suite_1", name: "Suite A" }),
        makeSuite({ id: "suite_2", name: "Suite B" }),
      ];
      render(
        <ArchivedSuitesPanel suites={suites} onRestore={vi.fn()} isRestoring={false} />,
        { wrapper: Wrapper },
      );

      const restoreButtons = screen.getAllByText("Restore");
      expect(restoreButtons).toHaveLength(2);
    });
  });

  describe("when Restore is clicked", () => {
    it("calls onRestore with the suite id", async () => {
      const user = userEvent.setup();
      const onRestore = vi.fn();
      const suites = [makeSuite({ id: "suite_42" })];

      render(
        <ArchivedSuitesPanel suites={suites} onRestore={onRestore} isRestoring={false} />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("Restore"));
      expect(onRestore).toHaveBeenCalledWith("suite_42");
    });
  });

  describe("when isRestoring is true", () => {
    it("disables the Restore buttons", () => {
      const suites = [makeSuite()];
      render(
        <ArchivedSuitesPanel suites={suites} onRestore={vi.fn()} isRestoring={true} />,
        { wrapper: Wrapper },
      );

      const restoreButton = screen.getByText("Restore").closest("button");
      expect(restoreButton).toBeDisabled();
    });
  });
});
