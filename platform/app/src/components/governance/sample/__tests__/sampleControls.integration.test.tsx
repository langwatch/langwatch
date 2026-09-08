/**
 * @vitest-environment jsdom
 *
 * The sample toggle and banner as the rest of the section will see them, and
 * the per-page memory behind them.
 *
 * The memory is the part worth mounting a component for: it reads and writes
 * session storage, and the failure it guards against is one page's choice
 * turning the samples on for a page the reader never touched.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SampleDataBanner, SampleDataToggle } from "../SampleDataControls";
import { type RealDataState, useSampleMode } from "../sampleMode";

const withChakra = (ui: ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);

/** A page reduced to the two things the kit gives it. */
function SamplePage({
  realData,
  storageKey,
}: {
  realData: RealDataState;
  storageKey?: string;
}) {
  const sample = useSampleMode({ realData, storageKey });
  return (
    <>
      <SampleDataToggle active={sample.active} onToggle={sample.toggle} />
      {sample.active && <SampleDataBanner />}
      {sample.active && <div>a sample panel</div>}
    </>
  );
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => cleanup());

describe("the governance sample toggle", () => {
  describe("given the page measured nothing", () => {
    /** @scenario "Sample panels fill a page with nothing measured on it" */
    it("shows the sample panels and the banner without being asked", () => {
      withChakra(<SamplePage realData="absent" />);

      expect(screen.getByText("a sample panel")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        /nothing here is real/i,
      );
    });
  });

  describe("given the page has real figures", () => {
    /** @scenario "Sample panels step aside once the page has real figures" */
    it("keeps the sample panels off and still offers them", () => {
      withChakra(<SamplePage realData="present" />);

      expect(screen.queryByText("a sample panel")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "See sample data" }),
      ).toBeInTheDocument();
    });
  });

  describe("given a read has not answered yet", () => {
    /** @scenario "An unanswered read shows no sample panels rather than flashing them" */
    it("shows nothing rather than flashing the samples up", () => {
      withChakra(<SamplePage realData="unknown" />);

      expect(screen.queryByText("a sample panel")).not.toBeInTheDocument();
    });
  });

  describe("when the reader turns the samples on", () => {
    /** @scenario "The reader's own choice outlives the data underneath it" */
    it("keeps them on even though the page has real figures", () => {
      withChakra(<SamplePage realData="present" />);

      fireEvent.click(screen.getByRole("button", { name: "See sample data" }));

      expect(screen.getByText("a sample panel")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Hide sample data" }),
      ).toHaveAttribute("aria-pressed", "true");
    });
  });
});

describe("the sample banner copy", () => {
  describe("when a page states its own reason", () => {
    /** @scenario "A page may reword the sample banner but not soften it" */
    it("renders the page's words in the same standing status strip", () => {
      withChakra(
        <SampleDataBanner>Nothing on this page is real yet.</SampleDataBanner>,
      );

      expect(screen.getByRole("status")).toHaveTextContent(
        "Nothing on this page is real yet.",
      );
    });
  });
});

describe("the remembered choice", () => {
  describe("given the reader chose on one page", () => {
    /** @scenario "One sample choice governs every governance page" */
    it("carries to the next governance page they open", () => {
      const first = withChakra(<SamplePage realData="present" />);
      fireEvent.click(screen.getByRole("button", { name: "See sample data" }));
      first.unmount();

      withChakra(<SamplePage realData="present" />);

      expect(screen.getByText("a sample panel")).toBeInTheDocument();
    });

    /** @scenario "Turning the samples off on one page turns them off everywhere" */
    it("takes the panels off a page that has nothing of its own to show", () => {
      const first = withChakra(<SamplePage realData="present" />);
      fireEvent.click(screen.getByRole("button", { name: "See sample data" }));
      fireEvent.click(screen.getByRole("button", { name: "Hide sample data" }));
      first.unmount();

      withChakra(<SamplePage realData="absent" />);

      expect(screen.queryByText("a sample panel")).not.toBeInTheDocument();
    });

    /** @scenario "A remembered sample choice survives leaving the page and coming back" */
    it("survives a remount of the same page", () => {
      const first = withChakra(<SamplePage realData="present" />);
      fireEvent.click(screen.getByRole("button", { name: "See sample data" }));
      first.unmount();

      withChakra(<SamplePage realData="present" />);

      expect(screen.getByText("a sample panel")).toBeInTheDocument();
    });
  });

  describe("given two toggles are on screen at once", () => {
    /** @scenario "Every sample toggle on screen moves together" */
    it("moves both without waiting for a remount", () => {
      withChakra(
        <>
          <SamplePage realData="present" />
          <SamplePage realData="present" />
        </>,
      );

      const [firstToggle] = screen.getAllByRole("button", {
        name: "See sample data",
      });
      fireEvent.click(firstToggle!);

      expect(
        screen.getAllByRole("button", { name: "Hide sample data" }),
      ).toHaveLength(2);
      expect(screen.getAllByText("a sample panel")).toHaveLength(2);
    });
  });
});
