/**
 * @vitest-environment jsdom
 *
 * ADR-144: an aggregate project reads its members' traces and takes no data
 * of its own, so the project switcher draws it as a stacked avatar named
 * "Aggregate project", in the list and on the chip when it is the open
 * project. A plain project keeps its single avatar.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { current } = vi.hoisted(() => ({
  current: {
    project: { id: "proj-app", name: "Support Bot", kind: "application" },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-acme" },
    project: current.project,
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: { user: { name: "Ana" } } }),
}));

vi.mock("~/components/useWorkspaceData", () => ({
  useWorkspaceData: () => ({
    teams: [
      {
        kind: "team",
        teamId: "team-support",
        orgId: "org-acme",
        label: "Support",
        canCreateProject: false,
      },
    ],
    projects: [
      {
        kind: "project",
        projectId: "proj-aggregate",
        teamId: "team-support",
        orgId: "org-acme",
        href: "/company-traces",
        label: "Company Traces",
        isAggregate: true,
      },
      {
        kind: "project",
        projectId: "proj-app",
        teamId: "team-support",
        orgId: "org-acme",
        href: "/support-bot",
        label: "Support Bot",
        isAggregate: false,
      },
    ],
    onCreateProjectForTeam: undefined,
  }),
}));

vi.mock("~/components/ui/link", () => ({
  Link: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ProductScopeControl } from "../shell/ProductScopeControl";

function renderControl() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProductScopeControl activeProductId="llm-ops" />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  current.project = {
    id: "proj-app",
    name: "Support Bot",
    kind: "application",
  };
});

describe("the project switcher", () => {
  describe("when ana opens the list", () => {
    /** @scenario "The app marks the aggregate and offers no way to add data to it" */
    it("draws the aggregate stacked and every other project single", async () => {
      renderControl();
      expect(queryAggregateAvatar(document.body)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Switch project" }));

      const aggregateRow = (await screen.findByText("Company Traces")).closest(
        "a",
      );
      const plainRow = screen
        .getAllByText("Support Bot")
        .map((node) => node.closest("a"))
        .find(Boolean);
      expect(queryAggregateAvatar(aggregateRow!)).toBeInTheDocument();
      expect(within(aggregateRow!).getByText("C")).toBeInTheDocument();
      expect(queryAggregateAvatar(plainRow!)).toBeNull();
      expect(within(plainRow!).getByText("S")).toBeInTheDocument();
    });
  });

  describe("when the aggregate is the open project", () => {
    /** @scenario "The app marks the aggregate and offers no way to add data to it" */
    it("draws the current-project chip stacked", () => {
      current.project = {
        id: "proj-aggregate",
        name: "Company Traces",
        kind: "aggregate",
      };

      renderControl();

      const chip = screen.getByRole("button", { name: "Switch project" });
      expect(queryAggregateAvatar(chip)).toBeInTheDocument();
    });
  });

  describe("when a plain project is the open project", () => {
    /** @scenario "The app marks the aggregate and offers no way to add data to it" */
    it("draws the current-project chip single", () => {
      renderControl();

      const chip = screen.getByRole("button", { name: "Switch project" });
      expect(queryAggregateAvatar(chip)).toBeNull();
      expect(within(chip).getByText("S")).toBeInTheDocument();
    });
  });
});

function queryAggregateAvatar(container: HTMLElement) {
  return within(container).queryByRole("img", { name: "Aggregate project" });
}
