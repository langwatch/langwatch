/**
 * @vitest-environment jsdom
 * The trace host hands the Integrate pane and drawer the project's legacy base
 * key off `organization.getAll`, since the session scope carries no credentials.
 * Spec: specs/features/onboarding/manual-setup-api-key.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { TEST_KEY, getAll, reading } = vi.hoisted(() => {
  const key = "sk-lw-test-fixture-not-a-real-key-000000000000";
  const graph = [
    {
      id: "org_1",
      name: "ACME",
      teams: [
        {
          id: "team_1",
          name: "ACME",
          projects: [{ id: "proj_agent", name: "Agent", slug: "acme-agent", apiKey: key }],
        },
      ],
    },
  ];
  return {
    TEST_KEY: key,
    getAll: vi.fn((_input: unknown, options: { enabled: boolean }) => ({
      data: options.enabled ? graph : undefined,
    })),
    reading: { actor: { id: "user_1" } } as { actor: { id: string } | null },
  };
});

vi.mock("../trace-api.ts", () => ({
  traceApi: { organization: { getAll: { useQuery: getAll } } },
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

function ProjectKey() {
  return <output aria-label="project key">{useTraceHost().project()?.apiKey ?? ""}</output>;
}

afterEach(() => {
  cleanup();
  getAll.mockClear();
});

describe("TraceHostMount", () => {
  describe("when a signed-in reader opens a project whose key the server sent", () => {
    /** @scenario "The trace explorer's integrate surfaces get the project's key" */
    it("hands that key on the project", () => {
      reading.actor = { id: "user_1" };
      render(
        <TraceHostMount>
          <ProjectKey />
        </TraceHostMount>,
      );

      expect(screen.getByLabelText("project key")).toHaveTextContent(TEST_KEY);
    });
  });

  describe("when nobody is signed in", () => {
    /** @scenario "The shared trace page asks for no key" */
    it("leaves the organization graph query disabled", () => {
      reading.actor = null;
      render(
        <TraceHostMount>
          <ProjectKey />
        </TraceHostMount>,
      );

      expect(getAll).toHaveBeenCalledWith({ isDemo: false }, { enabled: false });
      expect(screen.getByLabelText("project key").textContent).toBe("");
    });
  });
});
