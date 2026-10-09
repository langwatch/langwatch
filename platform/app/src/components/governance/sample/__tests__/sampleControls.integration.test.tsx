/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SampleDataBanner, SampleDataToggle } from "../SampleDataControls";
import { useSampleMode } from "../sampleMode";

const withChakra = (ui: ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);

/** The shared controls mounted without page-specific data decisions. */
function SamplePage() {
  const sample = useSampleMode();
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
    /** @scenario "An empty page waits for an explicit sample choice" */
    it("keeps samples off until the reader asks", () => {
      withChakra(<SamplePage />);

      expect(screen.queryByText("a sample panel")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "See sample data" }));
      expect(screen.getByText("a sample panel")).toBeInTheDocument();
    });
  });

  describe("given the page has real figures", () => {
    /** @scenario "Sample panels step aside once the page has real figures" */
    it("keeps the sample panels off and still offers them", () => {
      withChakra(<SamplePage />);

      expect(screen.queryByText("a sample panel")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "See sample data" }),
      ).toBeInTheDocument();
    });
  });

  describe("given a read has not answered yet", () => {
    /** @scenario "An unanswered read shows no sample panels rather than flashing them" */
    it("shows nothing rather than flashing the samples up", () => {
      withChakra(<SamplePage />);

      expect(screen.queryByText("a sample panel")).not.toBeInTheDocument();
    });
  });

  describe("when the reader turns the samples on", () => {
    /** @scenario "The reader's own choice outlives the data underneath it" */
    it("keeps them on even though the page has real figures", () => {
      withChakra(<SamplePage />);

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
      const first = withChakra(<SamplePage />);
      fireEvent.click(screen.getByRole("button", { name: "See sample data" }));
      first.unmount();

      withChakra(<SamplePage />);

      expect(screen.getByText("a sample panel")).toBeInTheDocument();
    });

    /** @scenario "Turning the samples off on one page turns them off everywhere" */
    it("takes the panels off a page that has nothing of its own to show", () => {
      const first = withChakra(<SamplePage />);
      fireEvent.click(screen.getByRole("button", { name: "See sample data" }));
      fireEvent.click(screen.getByRole("button", { name: "Hide sample data" }));
      first.unmount();

      withChakra(<SamplePage />);

      expect(screen.queryByText("a sample panel")).not.toBeInTheDocument();
    });

    /** @scenario "A remembered sample choice survives leaving the page and coming back" */
    it("survives a remount of the same page", () => {
      const first = withChakra(<SamplePage />);
      fireEvent.click(screen.getByRole("button", { name: "See sample data" }));
      first.unmount();

      withChakra(<SamplePage />);

      expect(screen.getByText("a sample panel")).toBeInTheDocument();
    });
  });

  describe("given two toggles are on screen at once", () => {
    /** @scenario "Every sample toggle on screen moves together" */
    it("moves both without waiting for a remount", () => {
      withChakra(
        <>
          <SamplePage />
          <SamplePage />
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
