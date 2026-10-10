/**
 * @vitest-environment jsdom
 *
 * The analytics overview's Custom Dashboards section. With no dashboards it
 * invites the reader to build one, except on an aggregate project
 * (ADR-144), which keeps no dashboards of its own and is offered no way to
 * add one, as the sidebar's Add Dashboard is not shown there either.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomReportsSection } from "../CustomReportsSection";

const { projectRef } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", slug: "acme", kind: "application" } },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: projectRef.current }),
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("~/utils/api", () => ({
  api: {
    dashboards: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

const renderSection = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <CustomReportsSection slug="acme" />
    </ChakraProvider>,
  );

afterEach(() => {
  cleanup();
});

describe("CustomReportsSection", () => {
  describe("given a project with no dashboards", () => {
    describe("when the project is an ordinary one", () => {
      it("invites the reader to build a dashboard", () => {
        projectRef.current = {
          id: "proj-1",
          slug: "acme",
          kind: "application",
        };

        renderSection();

        expect(screen.getByText("Build your own dashboard")).toBeTruthy();
        expect(screen.getByRole("button", { name: /Create/ })).toBeTruthy();
      });
    });

    describe("when the project is an aggregate", () => {
      /** @scenario "The app marks the aggregate and offers no way to add data to it" */
      it("offers no way to create a dashboard", () => {
        projectRef.current = { id: "agg-1", slug: "acme", kind: "aggregate" };

        renderSection();

        expect(screen.queryByText("Build your own dashboard")).toBeNull();
        expect(screen.queryByRole("button", { name: /Create/ })).toBeNull();
      });
    });
  });
});
