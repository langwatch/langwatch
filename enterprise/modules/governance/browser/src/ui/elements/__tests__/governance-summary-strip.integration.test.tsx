import { PageLayout } from "@langwatch/design-system/page-layout";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The summary strip, its cards and rows, and the two weights an empty pane's
 * action may take. Elements only: none of them fetches.
 *
 * Spec: specs/ai-governance/dashboard/governance-summary-strip.feature
 */
import { Button } from "@langwatch/design-system/primitives";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { Bot } from "lucide-react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { GovernanceEmptyState, GovernanceEmptyStateAction } from "../governance-empty-state.tsx";
import { GovernanceSummaryBar } from "../governance-summary-bar.tsx";
import {
  GovernanceSummaryCard,
  GovernanceSummaryRankRow,
  GovernanceSummaryStatusRow,
} from "../governance-summary-cards.tsx";
import { GovernanceSummarySparkline } from "../governance-summary-sparkline.tsx";

const renderInChakra = (element: ReactElement) => renderWithDesignSystem(element);

afterEach(() => cleanup());

describe("the summary strip", () => {
  describe("given four measured figures with hints", () => {
    /** @scenario "A summary strip states each figure beside the label it counts" */
    it("puts each figure beside its label and each hint under its own pair", () => {
      renderInChakra(
        <GovernanceSummaryBar
          testId="strip"
          items={[
            { key: "people", value: 3, label: "people", hint: "Metered or named" },
            { key: "departments", value: 2, label: "departments", hint: "The ones you created" },
            { key: "unmatched", value: 1, label: "unmatched" },
            { key: "unassigned", value: 4, label: "without a department" },
          ]}
        />,
      );

      const people = screen.getByTestId("strip-people");
      expect(people).toHaveTextContent("3people");
      expect(within(people).getByText("Metered or named")).toBeInTheDocument();
      expect(screen.getByTestId("strip-departments")).toHaveTextContent("The ones you created");
      expect(screen.getByTestId("strip-unassigned")).toHaveTextContent("4without a department");
      expect(screen.getByTestId("strip")).not.toHaveTextContent(/\b(dept|req|tok)\b/i);
    });
  });

  describe("given a figure that could not be measured", () => {
    /** @scenario "A summary figure that was never measured reads as an em dash" */
    it("reads it as an em dash and never as zero", () => {
      renderInChakra(
        <GovernanceSummaryBar
          testId="strip"
          items={[
            { key: "people", value: 3, label: "people" },
            { key: "departments", value: null, label: "departments" },
          ]}
        />,
      );

      const figure = screen.getByTestId("strip-departments");
      expect(figure).toHaveTextContent("—departments");
      expect(figure).not.toHaveTextContent("0");
    });
  });

  describe("given nothing to show", () => {
    /** @scenario "A summary strip with no figures draws no card at all" */
    it("draws no card", () => {
      renderInChakra(<GovernanceSummaryBar testId="strip" items={[]} />);

      expect(screen.queryByTestId("strip")).toBeNull();
    });
  });
});

describe("the summary cards", () => {
  describe("given an eyebrow and some content", () => {
    /** @scenario "A summary card names what it holds in an eyebrow above its content" */
    it("names the card in the eyebrow with the content beneath it", () => {
      renderInChakra(
        <GovernanceSummaryCard eyebrow="Fleet" testId="card">
          <span>eleven agents</span>
        </GovernanceSummaryCard>,
      );

      const card = screen.getByTestId("card");
      const eyebrow = within(card).getByText("Fleet");
      const content = within(card).getByText("eleven agents");
      expect(
        Boolean(eyebrow.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);
    });
  });

  describe("given a status row for eleven responding items", () => {
    /** @scenario "A status row states the count and what those items are doing" */
    it("states the count and the word, with a decorative dot", () => {
      const { container } = renderInChakra(
        <GovernanceSummaryStatusRow tone="good" value={11} label="responding" />,
      );

      expect(screen.getByText("11")).toBeInTheDocument();
      expect(screen.getByText("responding")).toBeInTheDocument();
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });
  });

  describe("given a ranked row for one spender", () => {
    /** @scenario "A ranked row puts the name on the left and its share on the right" */
    it("shows the name and the share in one row", () => {
      renderInChakra(<GovernanceSummaryRankRow label="support-copilot" value="38%" />);

      const name = screen.getByText("support-copilot");
      const share = screen.getByText("38%");
      expect(name.parentElement).toBe(share.parentElement);
      expect(Boolean(name.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
        true,
      );
    });
  });

  describe("given fewer than two points to plot", () => {
    /** @scenario "A summary sparkline is left out when there is nothing to draw" */
    it.each([[[]], [[7]]])("draws no sparkline and no flat line for %j", (points) => {
      renderInChakra(<GovernanceSummarySparkline points={points} label="Agents over time" />);

      expect(screen.queryByTestId("governance-summary-sparkline")).toBeNull();
      expect(document.querySelector("polyline")).toBeNull();
    });
  });
});

describe("the action of an empty pane", () => {
  const paneWith = (emphasis: "primary" | "secondary") => (
    <>
      <GovernanceEmptyState
        icon={Bot}
        headline="Nothing yet"
        description="Nothing is here."
        action={
          <GovernanceEmptyStateAction emphasis={emphasis}>The action</GovernanceEmptyStateAction>
        }
      />
      <PageLayout.HeaderButton primary>House</PageLayout.HeaderButton>
      <Button size="sm" variant="ghost">
        Ghost
      </Button>
    </>
  );
  const classOf = (name: string) => screen.getByRole("button", { name }).className;

  describe("given an action that creates the page's own thing", () => {
    /** @scenario "An empty pane action is drawn as the house header button" */
    /** @scenario "An empty pane's action is weighted by what it does" */
    it("is drawn exactly as the house header button", () => {
      renderInChakra(paneWith("primary"));

      expect(classOf("The action")).toBe(classOf("House"));
    });
  });

  describe("given a way out that only changes what is shown", () => {
    /** @scenario "A quieter empty pane action is drawn quieter than the house button" */
    /** @scenario "An empty pane's action is weighted by what it does" */
    it("is drawn quieter than the house button", () => {
      renderInChakra(paneWith("secondary"));

      expect(classOf("The action")).toBe(classOf("Ghost"));
      expect(classOf("The action")).not.toBe(classOf("House"));
    });
  });
});
