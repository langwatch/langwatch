/**
 * @vitest-environment jsdom
 * The trace host reads key, first-trace flag and presence off `organization.getAll`.
 * Specs: specs/features/onboarding/manual-setup-api-key.feature,
 * specs/traces-v2/onboarding-empty-state.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  apiKey: string;
  firstMessage: boolean;
  presenceEnabled: boolean;
};

const { TEST_KEY, getAll, hasFirstMessage, invalidateGraph, reading, row, utils } = vi.hoisted(() => {
  const invalidate = vi.fn();
  const key = "sk-lw-test-fixture-not-a-real-key-000000000000";
  const projectRow = {
    id: "proj_agent",
    name: "Agent",
    slug: "acme-agent",
    apiKey: key,
    firstMessage: true,
    presenceEnabled: true,
  };
  const organizationRow = { presenceEnabled: true };
  const graph = () => [
    {
      id: "org_1",
      name: "ACME",
      presenceEnabled: organizationRow.presenceEnabled,
      teams: [{ id: "team_1", name: "ACME", projects: [{ ...projectRow }] }],
    },
  ];
  return {
    TEST_KEY: key,
    row: { project: projectRow, organization: organizationRow },
    getAll: vi.fn((_input: unknown, options: { enabled: boolean }) => ({
      data: options.enabled ? graph() : undefined,
    })),
    hasFirstMessage: {
      data: undefined as { firstMessage: boolean } | undefined,
      useQuery: vi.fn(),
    },
    invalidateGraph: invalidate,
    utils: { organization: { getAll: { invalidate } } },
    reading: { actor: { id: "user_1" } } as { actor: { id: string } | null },
  };
});

vi.mock("../trace-api.ts", () => ({
  traceApi: {
    organization: { getAll: { useQuery: getAll } },
    project: { getHasFirstMessage: { useQuery: hasFirstMessage.useQuery } },
    useUtils: () => utils,
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

import TraceHostMount, { firstTracePollInterval } from "../trace-host-mount.tsx";
import { useTraceHost } from "../trace-host.ts";

function ProjectReading() {
  const host = useTraceHost();
  const project: Partial<ProjectRow> | undefined = host.project();
  return (
    <>
      <output aria-label="project key">{project?.apiKey ?? ""}</output>
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
  row.project.firstMessage = true;
  row.project.presenceEnabled = true;
  row.organization.presenceEnabled = true;
  hasFirstMessage.data = undefined;
  hasFirstMessage.useQuery.mockImplementation(() => ({ data: hasFirstMessage.data }));
});

afterEach(() => {
  cleanup();
  getAll.mockClear();
  hasFirstMessage.useQuery.mockReset();
  invalidateGraph.mockClear();
});

describe("TraceHostMount", () => {
  describe("when a signed-in reader opens a project whose key the server sent", () => {
    /** @scenario "The trace explorer's integrate surfaces get the project's key" */
    it("hands that key on the project", () => {
      renderMount();

      expect(screen.getByLabelText("project key")).toHaveTextContent(TEST_KEY);
    });
  });

  describe("when nobody is signed in", () => {
    /** @scenario "The shared trace page asks for no key" */
    it("leaves the organization graph query disabled", () => {
      reading.actor = null;
      renderMount();

      expect(getAll).toHaveBeenCalledWith({ isDemo: false }, { enabled: false });
      expect(screen.getByLabelText("project key").textContent).toBe("");
    });
  });

  describe("when the project has never received a trace", () => {
    /** @scenario "The trace explorer learns from the project record that it has no trace yet" */
    it("hands the explorer a false first-trace flag", () => {
      row.project.firstMessage = false;
      renderMount();

      expect(screen.getByLabelText("first message")).toHaveTextContent("false");
    });
  });

  describe("when the first trace lands while the explorer is open", () => {
    /** @scenario "The Trace Explorer leaves its empty state when the first trace arrives" */
    it("polls the first-trace read, flips the flag and refreshes the project record", () => {
      row.project.firstMessage = false;
      hasFirstMessage.data = { firstMessage: false };
      const { rerender } = renderMount();

      const [input, options] = hasFirstMessage.useQuery.mock.lastCall as [
        unknown,
        { enabled: boolean; refetchInterval: (query: unknown) => number | false },
      ];
      expect(input).toEqual({ projectId: "proj_agent" });
      expect(options.enabled).toBe(true);
      expect(screen.getByLabelText("first message")).toHaveTextContent("false");
      expect(invalidateGraph).not.toHaveBeenCalled();

      hasFirstMessage.data = { firstMessage: true };
      rerender(
        <TraceHostMount>
          <ProjectReading />
        </TraceHostMount>,
      );

      expect(screen.getByLabelText("first message")).toHaveTextContent("true");
      expect(invalidateGraph).toHaveBeenCalledTimes(1);
    });

    it("stops polling once the flag is true", () => {
      expect(firstTracePollInterval({ firstMessage: false })).toBe(5_000);
      expect(firstTracePollInterval(undefined)).toBe(5_000);
      expect(firstTracePollInterval({ firstMessage: true })).toBe(false);
    });
  });

  describe("when the project already has traces", () => {
    it("does not poll the first-trace read", () => {
      renderMount();

      const [, options] = hasFirstMessage.useQuery.mock.lastCall as [unknown, { enabled: boolean }];
      expect(options.enabled).toBe(false);
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
