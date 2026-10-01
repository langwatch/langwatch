/**
 * @vitest-environment jsdom
 * Presence comes off `getScopeGraph`, the first-trace flag off `getHasFirstMessage`. Specs:
 * specs/features/onboarding/manual-setup-api-key.feature,
 * specs/traces-v2/onboarding-empty-state.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { getScopeGraph, hasFirstMessage, reading, row } = vi.hoisted(() => {
  const projectRow = { presenceEnabled: true };
  const organizationRow = { presenceEnabled: true };
  const graph = () => [
    {
      id: "org_1",
      presenceEnabled: organizationRow.presenceEnabled,
      teams: [{ id: "team_1", projects: [{ id: "proj_agent", ...projectRow }] }],
    },
  ];
  return {
    row: { project: projectRow, organization: organizationRow },
    getScopeGraph: vi.fn((_input: unknown, options: { enabled: boolean }) => ({
      data: options.enabled ? graph() : undefined,
    })),
    hasFirstMessage: {
      data: undefined as { firstMessage: boolean } | undefined,
      useQuery: vi.fn(),
    },
    reading: { actor: { id: "user_1" } } as { actor: { id: string } | null },
  };
});

vi.mock("../trace-api.ts", () => ({
  traceApi: {
    organization: { getScopeGraph: { useQuery: getScopeGraph } },
    project: { getHasFirstMessage: { useQuery: hasFirstMessage.useQuery } },
  },
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const session = {
    snapshot: () => ({
      scope: {
        status: "ready",
        organization: { id: "org_1", name: "ACME" },
        team: { id: "team_1", name: "ACME" },
        project: { id: "proj_agent", slug: "acme-agent", name: "Agent" },
      },
    }),
    currentUser: () => reading.actor,
    hasPermission: () => true,
  };
  return {
    ...original,
    useUiCapabilities: () => ({
      session,
      navigation: { navigate: vi.fn(), replace: vi.fn() },
      route: { reading: () => ({ params: {}, query: {} }), setQuery: vi.fn() },
      feedback: { succeeded: vi.fn(), failed: vi.fn() },
    }),
  };
});

import TraceHostMount from "../trace-host-mount.tsx";
import { useTraceHost } from "../trace-host.ts";

function ProjectReading() {
  const host = useTraceHost();
  const project = host.project();
  return (
    <>
      <output aria-label="first message">{String(project?.firstMessage)}</output>
      <output aria-label="project presence">{String(project?.presenceEnabled)}</output>
      <output aria-label="organization presence">
        {String(host.organization()?.presenceEnabled)}
      </output>
    </>
  );
}

function renderMount() {
  return render(
    <TraceHostMount>
      <ProjectReading />
    </TraceHostMount>,
  );
}

beforeEach(() => {
  reading.actor = { id: "user_1" };
  row.project.presenceEnabled = true;
  row.organization.presenceEnabled = true;
  hasFirstMessage.data = { firstMessage: true };
  hasFirstMessage.useQuery.mockImplementation(() => ({ data: hasFirstMessage.data }));
});

afterEach(() => {
  cleanup();
  getScopeGraph.mockClear();
  hasFirstMessage.useQuery.mockReset();
});

describe("TraceHostMount", () => {
  describe("when nobody is signed in", () => {
    /** @scenario "The shared trace page asks for no key" */
    it("leaves the scope graph and first-trace queries disabled", () => {
      reading.actor = null;
      renderMount();

      expect(getScopeGraph).toHaveBeenCalledWith({}, { enabled: false });
      const [, options] = hasFirstMessage.useQuery.mock.lastCall as [unknown, { enabled: boolean }];
      expect(options.enabled).toBe(false);
    });
  });

  describe("when the project has never received a trace", () => {
    /** @scenario "The trace explorer learns from the project record that it has no trace yet" */
    it("hands the explorer a false first-trace flag", () => {
      hasFirstMessage.data = { firstMessage: false };
      renderMount();

      expect(screen.getByLabelText("first message")).toHaveTextContent("false");
    });
  });

  describe("when the first trace lands while the explorer is open", () => {
    /** @scenario "The Trace Explorer leaves its empty state when the first trace arrives" */
    it("reads the first-trace flag and flips it", () => {
      hasFirstMessage.data = { firstMessage: false };
      const { rerender } = renderMount();

      const [input, options] = hasFirstMessage.useQuery.mock.lastCall as [
        unknown,
        { enabled: boolean },
      ];
      expect(input).toEqual({ projectId: "proj_agent" });
      expect(options.enabled).toBe(true);
      expect(options).not.toHaveProperty("refetchInterval");
      expect(screen.getByLabelText("first message")).toHaveTextContent("false");

      hasFirstMessage.data = { firstMessage: true };
      rerender(
        <TraceHostMount>
          <ProjectReading />
        </TraceHostMount>,
      );

      expect(screen.getByLabelText("first message")).toHaveTextContent("true");
    });

  });

  describe("when the organization turned presence off", () => {
    /** @scenario "The trace explorer follows the presence switches on the project record" */
    it("hands both presence switches to the explorer", () => {
      row.organization.presenceEnabled = false;
      row.project.presenceEnabled = false;
      renderMount();

      expect(screen.getByLabelText("organization presence")).toHaveTextContent("false");
      expect(screen.getByLabelText("project presence")).toHaveTextContent("false");
    });
  });
});
