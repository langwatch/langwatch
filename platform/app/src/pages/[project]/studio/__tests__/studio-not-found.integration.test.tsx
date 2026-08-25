/**
 * @vitest-environment jsdom
 *
 * A workflow that isn't there explains itself, inside the app.
 *
 * A live UX pass opened `/[project]/studio/does-not-exist` and got a bare
 * full-screen "404 / An error occurred" — no navigation, no way back, and no
 * hint of what was missing — while the query underneath it held a perfectly
 * good `workflow_not_found`. Two things were wrong and both are asserted here:
 * the words, and the shell that lets the reader leave.
 *
 * `DashboardLayout` is stubbed to a marker rather than rendered: what matters
 * is that the error is returned INSIDE it (the sidebar is the way out), not
 * how the sidebar itself paints.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { workflowRef } = vi.hoisted(() => ({
  workflowRef: { current: {} as Record<string, unknown> },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { slug: "ux-review" } }),
}));

vi.mock("~/components/ui/link", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="dashboard-layout">{children}</div>
  ),
}));

vi.mock("../../../../optimization_studio/hooks/useLoadWorkflow", () => ({
  useLoadWorkflow: () => ({ workflow: workflowRef.current }),
}));

vi.mock("../../../../optimization_studio/components/OptimizationStudio", () => ({
  default: () => <div data-testid="studio-canvas" />,
}));

vi.mock("@langwatch/workflow-web", () => ({
  useWorkflowStore: () => ({
    reset: vi.fn(),
    setWorkflow: vi.fn(),
    setAutosavedWorkflow: vi.fn(),
    setLastCommittedWorkflow: vi.fn(),
    setCurrentVersionId: vi.fn(),
  }),
  _useWorkflowStore: {
    temporal: { getState: () => ({ clear: vi.fn() }) },
    getState: () => ({ getWorkflow: () => ({}) }),
  },
}));

vi.mock("../../../../utils/api", () => ({
  api: {
    useUtils: () => ({ workflow: { getById: { invalidate: vi.fn() } } }),
  },
}));

import Studio from "../[workflow]";

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <Studio />
    </ChakraProvider>,
  );

/** The tRPC envelope a handled error arrives in on the client. */
const handled = (code: string, httpStatus: number) => ({
  data: { error: { code, httpStatus, fault: "customer" } },
});

describe("Studio page", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  describe("when the workflow does not exist", () => {
    /** @scenario "A workflow that does not exist explains itself in the app shell" */
    it("names the failure and keeps the navigation", () => {
      workflowRef.current = {
        isError: true,
        isFetched: true,
        data: undefined,
        error: handled("workflow_not_found", 404),
      };

      renderPage();

      // The registry's copy for `workflow_not_found`, not a status code.
      expect(screen.getByText("Workflow not found")).toBeTruthy();
      expect(screen.getByTestId("dashboard-layout")).toBeTruthy();
      expect(screen.queryByTestId("studio-canvas")).toBeNull();
      // A dead end needs a way out of it, not just a sentence about it.
      expect(screen.getByRole("link", { name: /back to workflows/i })).toBeTruthy();
    });
  });

  describe("when the workflow fails to load for another reason", () => {
    /** @scenario "A workflow that fails to load explains itself in the app shell" */
    it("explains it in place rather than blanking the screen", () => {
      workflowRef.current = {
        isError: true,
        isFetched: true,
        data: undefined,
        error: handled("clickhouse_unavailable", 503),
      };

      renderPage();

      expect(screen.getByTestId("dashboard-layout")).toBeTruthy();
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.queryByTestId("studio-canvas")).toBeNull();
    });
  });

  describe("when the workflow loads", () => {
    it("renders the editor", () => {
      workflowRef.current = {
        isError: false,
        isFetched: true,
        data: { id: "wf_1", currentVersion: { id: "v1", dsl: undefined } },
        error: null,
      };

      renderPage();

      expect(screen.getByTestId("studio-canvas")).toBeTruthy();
    });
  });
});
