/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BugReportsView from "../ui/sections/bug-reports-view";
import { renderWithOpsHost } from "../../../testing";

const listState = vi.hoisted(() => ({
  current: {
    data: undefined as unknown,
    isLoading: false,
    isFetching: false,
    error: null as Error | null,
  },
}));
const byIdState = vi.hoisted(() => ({
  current: {
    data: undefined as unknown,
    error: null as Error | null,
  },
}));
const routerState = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  replace: vi.fn(),
}));

vi.mock("../../../behavior/ops-api", () => ({
  api: {
    bugReports: {
      getAll: { useQuery: () => listState.current },
      getById: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) =>
          opts?.enabled ? byIdState.current : { data: undefined, error: null },
      },
    },
  },
}));

vi.mock("../../../behavior/ops-router", () => ({
  useOpsRouter: () => ({
    query: routerState.query,
    replace: routerState.replace,
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const sampleReports = [
  {
    id: "rep-1",
    createdAt: new Date("2026-07-24T10:00:00Z").toISOString(),
    source: "cli",
    kind: "full_session",
    title: "agent stuck instrumenting python",
    summary: "the docs pointed to a removed endpoint",
    sessionTruncated: false,
    agent: "claude-code",
    contactEmail: "dev@acme.com",
    cliVersion: "0.36.0",
    linkedProjectId: "proj-1",
    metadata: null,
  },
  {
    id: "rep-2",
    createdAt: new Date("2026-07-23T09:00:00Z").toISOString(),
    source: "mcp",
    kind: "summary",
    title: "evaluator wizard 404",
    summary: "step 2 404s",
    sessionTruncated: false,
    agent: null,
    contactEmail: null,
    cliVersion: null,
    linkedProjectId: null,
    metadata: null,
  },
];

function renderView() {
  return renderWithOpsHost(<BugReportsView />);
}

describe("BugReportsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerState.query = {};
    listState.current = {
      data: { reports: sampleReports, total: 2 },
      isLoading: false,
      isFetching: false,
      error: null,
    };
    byIdState.current = {
      data: {
        ...sampleReports[0],
        sessionData: '{"role":"user","content":"my key [SECRET] failed"}',
      },
      error: null,
    };
  });

  describe("given stored reports", () => {
    /** @scenario "Admins see reports in the backoffice" */
    it("lists them with date, kind, agent, project, and contact", () => {
      renderView();
      expect(screen.getByText("agent stuck instrumenting python")).toBeInTheDocument();
      expect(screen.getByText("evaluator wizard 404")).toBeInTheDocument();
      expect(screen.getByText("Full session")).toBeInTheDocument();
      expect(screen.getByText("Summary")).toBeInTheDocument();
      expect(screen.getByText("claude-code")).toBeInTheDocument();
      expect(screen.getByText("proj-1")).toBeInTheDocument();
      expect(screen.getByText("dev@acme.com")).toBeInTheDocument();
    });
  });

  describe("when the report title is activated", () => {
    it("deep-links the report id into the URL", () => {
      renderView();
      fireEvent.click(screen.getByText("agent stuck instrumenting python"));
      expect(routerState.replace).toHaveBeenCalledWith({ query: { report: "rep-1" } }, undefined, {
        shallow: true,
      });
    });
  });

  describe("given a report id in the URL", () => {
    it("opens the drawer with the full summary and redacted transcript", async () => {
      routerState.query = { report: "rep-1" };
      renderView();
      await waitFor(() => {
        expect(screen.getByText("the docs pointed to a removed endpoint")).toBeInTheDocument();
      });
      expect(screen.getByText(/my key \[SECRET\] failed/)).toBeInTheDocument();
      expect(screen.getByText("Download .jsonl")).toBeInTheDocument();
    });
  });

  describe("given no stored reports", () => {
    it("explains where reports come from", () => {
      listState.current = {
        data: { reports: [], total: 0 },
        isLoading: false,
        isFetching: false,
        error: null,
      };
      renderView();
      expect(screen.getByText(/No reports yet/)).toBeInTheDocument();
    });
  });
});
