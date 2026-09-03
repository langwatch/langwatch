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
 * `DashboardLayout` NO LONGER APPEARS HERE. Chrome belongs to the route tree,
 * and this address is served without a layout route above it — so the dead end
 * owns the viewport and the way out is the button rather than the sidebar. That
 * button is what the first scenario asserts instead.
 *
 * THE WORDS ARE THE HOST'S. The code-keyed presentation registry stayed in the
 * composing application, so what this screen guarantees is the action that
 * failed ("Couldn't open this workflow") plus a live region — not the
 * registry's own sentence for `workflow_not_found`.
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

vi.mock("../../../ui/elements/studio-host/link", () => ({
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
