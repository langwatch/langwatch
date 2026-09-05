/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowHostProvider } from "../../../model/workflow-host";

const { workflowRef } = vi.hoisted(() => ({
  workflowRef: { current: {} as Record<string, unknown> },
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
vi.mock("../../../behavior/studio-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { slug: "ux-review" } }),
}));

vi.mock("@langwatch/ui-host/link", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../../../behavior/optimization_studio/use-load-workflow", () => ({
  useLoadWorkflow: () => ({ workflow: workflowRef.current }),
}));

vi.mock("../../../ui/sections/optimization_studio/optimization-studio", () => ({
  default: () => <div data-testid="studio-canvas" />,
}));

vi.mock("../../../behavior/studio-host/api", () => ({
  api: {
    useUtils: () => ({ workflow: { getById: { invalidate: vi.fn() } } }),
  },
}));

import Studio from "../studio.screen";
import { FakeWorkflowHost } from "../../../testing";

// The screen binds the studio's two module-scope singletons (feedback and
// error reporting) to the mounted host on render, so it needs a host above it
// exactly as the application gives it one.
const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <WorkflowHostProvider value={new FakeWorkflowHost()}>
        <Studio />
      </WorkflowHostProvider>
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

      // The action that failed, named rather than a status code. The specific
      // sentence for `workflow_not_found` is the host registry's and is
      // asserted where that registry lives.
      expect(screen.getByText("Couldn't open this workflow")).toBeTruthy();
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
