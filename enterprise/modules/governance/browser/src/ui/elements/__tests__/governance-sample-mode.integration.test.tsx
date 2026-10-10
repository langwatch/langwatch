/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { writeSampleChoice, useSampleMode } from "../governance-sample-mode.ts";
import { SampleDataBanner, SampleDataToggle } from "../sample-data-controls.tsx";

function GovernancePage({ name }: { name: string }) {
  const sample = useSampleMode();
  return (
    <section aria-label={name}>
      <SampleDataToggle active={sample.active} onToggle={sample.toggle} />
      {sample.active && <p>{`${name} sample panels`}</p>}
    </section>
  );
}

function renderWithChakra(node: React.ReactNode) {
  return renderWithDesignSystem(node);
}

function toggleIn(name: string) {
  const page = screen.getByRole("region", { name });
  const button = page.querySelector("button");
  if (!button) throw new Error(`no sample toggle on ${name}`);
  return button;
}

afterEach(() => {
  cleanup();
  writeSampleChoice(null);
});

describe("the governance section's one sample choice", () => {
  describe("given the reader turned the samples on for one page", () => {
    /** @scenario "One sample choice governs every governance page" */
    it("shows the sample panels on a different page opened afterwards", () => {
      const costs = renderWithChakra(<GovernancePage name="Costs" />);
      fireEvent.click(toggleIn("Costs"));
      costs.unmount();

      renderWithChakra(<GovernancePage name="People" />);

      expect(screen.getByText("People sample panels")).toBeInTheDocument();
    });

    /** @scenario "A remembered sample choice survives leaving the page and coming back" */
    it("still shows them after leaving the page and returning", () => {
      const first = renderWithChakra(<GovernancePage name="Costs" />);
      fireEvent.click(toggleIn("Costs"));
      first.unmount();

      renderWithChakra(<GovernancePage name="Costs" />);

      expect(screen.getByText("Costs sample panels")).toBeInTheDocument();
    });
  });

  describe("given the reader turned the samples off for one page", () => {
    /** @scenario "Turning the samples off on one page turns them off everywhere" */
    it("shows no sample panels on another page either", () => {
      writeSampleChoice(true);
      const costs = renderWithChakra(<GovernancePage name="Costs" />);
      fireEvent.click(toggleIn("Costs"));
      costs.unmount();

      renderWithChakra(<GovernancePage name="Agents" />);

      expect(screen.queryByText("Agents sample panels")).not.toBeInTheDocument();
    });
  });

  describe("given two sample toggles are on screen at once", () => {
    /** @scenario "Every sample toggle on screen moves together" */
    it("reads the other toggle as pressed without a reload", () => {
      renderWithChakra(
        <>
          <GovernancePage name="Header" />
          <GovernancePage name="Panel" />
        </>,
      );

      fireEvent.click(toggleIn("Header"));

      expect(toggleIn("Panel")).toHaveAttribute("aria-pressed", "true");
    });
  });
});

describe("a page's own sample banner wording", () => {
  /** @scenario "A page may reword the sample banner but not soften it" */
  it("carries the page's words on the same status strip, never an alert", () => {
    renderWithChakra(<SampleDataBanner>These agents are invented for the tour.</SampleDataBanner>);

    expect(screen.getByRole("status")).toHaveTextContent("These agents are invented for the tour.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
