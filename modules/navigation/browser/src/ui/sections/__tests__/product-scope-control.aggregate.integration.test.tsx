/**
 * @vitest-environment jsdom
 *
 * ADR-177: the project switcher draws an aggregate as a stacked avatar named "Aggregate
 * project", in the list and on the chip. Ported from main's ProjectScopeAggregateAvatar test.
 * @see specs/governance/aggregate-project.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { NavigationProject } from "@langwatch/navigation-contract";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WithStubNavigationHost } from "../../../testing.tsx";
import { ProductScopeControl } from "../product-scope-control.tsx";

const aggregate: NavigationProject = {
  id: "proj-aggregate",
  name: "Company Traces",
  slug: "company-traces",
  kind: "aggregate",
};
const plain: NavigationProject = {
  id: "proj-app",
  name: "Support Bot",
  slug: "support-bot",
  kind: "application",
};
const organization = {
  id: "org-acme",
  name: "Acme",
  teams: [{ id: "team-support", name: "Support", projects: [aggregate, plain] }],
};

function renderControl(project: NavigationProject) {
  renderWithDesignSystem(
    <WithStubNavigationHost readings={{ organization, organizations: [organization], project }}>
      <ProductScopeControl activeProductId="llm-ops" />
    </WithStubNavigationHost>,
  );
}

function queryAggregateAvatar(container: HTMLElement) {
  return within(container).queryByRole("img", { name: "Aggregate project" });
}

afterEach(cleanup);

describe("the project switcher", () => {
  describe("when ana opens the list", () => {
    /** @scenario "The app marks the aggregate and offers no way to add data to it" */
    it("draws the aggregate stacked and every other project single", async () => {
      renderControl(plain);

      fireEvent.click(screen.getByRole("button", { name: "Switch project" }));

      const aggregateRow = (await screen.findByText("Company Traces")).closest("a");
      const plainRow = screen
        .getAllByText("Support Bot")
        .map((node) => node.closest("a"))
        .find((row) => row !== null);
      if (!aggregateRow || !plainRow) throw new Error("expected both project rows");
      expect(queryAggregateAvatar(aggregateRow)).toBeInTheDocument();
      expect(within(aggregateRow).getByText("C")).toBeInTheDocument();
      expect(queryAggregateAvatar(plainRow)).toBeNull();
      expect(within(plainRow).getByText("S")).toBeInTheDocument();
    });
  });

  describe("when the aggregate is the open project", () => {
    /** @scenario "The app marks the aggregate and offers no way to add data to it" */
    it("draws the current-project chip stacked", () => {
      renderControl(aggregate);

      const chip = screen.getByRole("button", { name: "Switch project" });
      expect(queryAggregateAvatar(chip)).toBeInTheDocument();
    });
  });

  describe("when a plain project is the open project", () => {
    /** @scenario "The app marks the aggregate and offers no way to add data to it" */
    it("draws the current-project chip single", () => {
      renderControl(plain);

      const chip = screen.getByRole("button", { name: "Switch project" });
      expect(queryAggregateAvatar(chip)).toBeNull();
      expect(within(chip).getByText("S")).toBeInTheDocument();
    });
  });
});
