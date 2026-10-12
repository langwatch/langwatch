/**
 * @vitest-environment jsdom
 *
 * ADR-144: an aggregate project has no home, so opening its home lands on its
 * Trace Explorer, replacing the home in the history. An ordinary project's
 * home renders as before.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  project: undefined as { slug: string; kind: string } | undefined,
  query: {} as Record<string, string>,
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: state.project }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: state.query,
    push: state.push,
    replace: state.replace,
  }),
}));

vi.mock("../../../components/home/HomePage", () => ({
  HomePage: () => <div data-testid="home-page" />,
}));

import ProjectHome from "../index";

describe("the project home page", () => {
  beforeEach(() => {
    state.project = undefined;
    state.query = {};
    state.push.mockReset();
    state.replace.mockReset();
  });

  afterEach(cleanup);

  describe("when the open project is an aggregate", () => {
    /** @scenario "Opening an aggregate's home lands on the Trace Explorer" */
    it("replaces the home with the aggregate's Trace Explorer and renders no home", () => {
      state.project = { slug: "company-traces", kind: "aggregate" };

      render(<ProjectHome />);

      expect(state.replace).toHaveBeenCalledWith("/company-traces/traces");
      expect(state.push).not.toHaveBeenCalled();
      expect(screen.queryByTestId("home-page")).toBeNull();
    });
  });

  describe("when the open project is an ordinary project", () => {
    it("renders the home and redirects nowhere", () => {
      state.project = { slug: "chatbot", kind: "application" };

      render(<ProjectHome />);

      expect(screen.getByTestId("home-page")).toBeDefined();
      expect(state.replace).not.toHaveBeenCalled();
      expect(state.push).not.toHaveBeenCalled();
    });
  });

  describe("when an aggregate's home carries a return_to", () => {
    it("follows the return_to instead of the Trace Explorer", () => {
      state.project = { slug: "company-traces", kind: "aggregate" };
      state.query = { return_to: "/company-traces/traces/trace-1" };

      render(<ProjectHome />);

      expect(state.push).toHaveBeenCalledWith("/company-traces/traces/trace-1");
      expect(state.replace).not.toHaveBeenCalled();
    });
  });
});
