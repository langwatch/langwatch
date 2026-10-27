/**
 * @vitest-environment jsdom
 * The match engine's two doors on the People screen: the proof-pass button and the review queue.
 * Real page, mocked boundary; the mutations answer as the server would and record what they
 * were sent.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";

const harness = vi.hoisted(() => ({
  suggestions: [] as unknown[],
  calls: [] as { path: string; input: unknown }[],
  answers: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  announce() {
    for (const listener of this.listeners) listener();
  },
}));

vi.mock("../../../../behavior/governance-api.ts", async () => {
  const React = await import("react");
  const dataFor = (path: string): unknown => {
    if (path === "governancePeople.suggestions") return harness.suggestions;
    if (path === "governancePeople.list") return [];
    return undefined;
  };
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          const here = path.join(".");
          if (property === "useQuery") {
            return () => {
              const [, refresh] = React.useReducer((count: number) => count + 1, 0);
              React.useEffect(() => {
                harness.listeners.add(refresh);
                return () => void harness.listeners.delete(refresh);
              }, []);
              return {
                data: dataFor(here),
                isLoading: false,
                isFetching: false,
                isError: false,
                error: null,
                refetch: vi.fn(),
              };
            };
          }
          if (property === "useMutation") {
            return (options?: { onSuccess?: (answer: unknown) => unknown }) => ({
              mutate: (input: unknown) => {
                harness.calls.push({ path: here, input });
                void options?.onSuccess?.(harness.answers[here]);
              },
              mutateAsync: vi.fn(),
              isPending: false,
              variables: undefined,
            });
          }
          if (property === "invalidate") {
            return async () => {
              if (here === "governancePeople.suggestions") harness.suggestions = [];
              harness.announce();
            };
          }
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );
  return { api: node([]) };
});

import PeoplePage from "../governance-people.screen.tsx";

const SUGGESTION = {
  id: "sug_1",
  discoveredPersonId: "person_1",
  personDisplayText: "M Silva",
  personProvider: "copilot_studio_dataverse",
  userId: "user_9",
  memberName: "Maria Silva",
  score: 0.91,
};

function renderPage({ permissions }: { permissions: string[] }) {
  const host = FakeGovernanceHost.create({ permissions, query: {} });
  renderWithGovernanceHost(
    <MemoryRouter initialEntries={["/governance/people"]}>
      <PeoplePage />
    </MemoryRouter>,
    { host },
  );
  return host;
}

afterEach(() => {
  cleanup();
  harness.suggestions = [];
  harness.calls = [];
  harness.answers = {};
  harness.listeners.clear();
  window.sessionStorage.clear();
});

describe("given a governance manager on the People screen", () => {
  describe("when they press the match button", () => {
    /** @scenario "The match button runs the proof pass" */
    it("asks the engine to run and says how many were linked and how many remain unproven", async () => {
      harness.answers["governancePeople.runMatch"] = { linked: 2, suspended: 0, unproven: 3 };
      const host = renderPage({ permissions: ["activityMonitor:view", "governance:manage"] });

      await userEvent.click(screen.getByRole("button", { name: /Run match pass/ }));

      expect(harness.calls).toEqual([
        { path: "governancePeople.runMatch", input: { organizationId: "org-1" } },
      ]);
      expect(host.recording.successes[0]).toMatchObject({
        title: "Match pass finished",
        description: expect.stringContaining("2 linked, 3 unproven"),
      });
    });
  });

  describe("when a suggestion is stored", () => {
    /** @scenario "A suggestion shows both halves and a confirm action" */
    it("shows the provider-named person beside the account, and confirming removes it", async () => {
      harness.suggestions = [SUGGESTION];
      harness.answers["governancePeople.confirmSuggestion"] = {
        discoveredPersonId: "person_1",
        userId: "user_9",
      };
      const host = renderPage({ permissions: ["activityMonitor:view", "governance:manage"] });

      expect(screen.getByText("M Silva")).toBeInTheDocument();
      expect(screen.getByText("(copilot_studio_dataverse)")).toBeInTheDocument();
      expect(screen.getByText("Maria Silva")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

      expect(harness.calls).toEqual([
        {
          path: "governancePeople.confirmSuggestion",
          input: { organizationId: "org-1", suggestionId: "sug_1" },
        },
      ]);
      expect(host.recording.successes[0]).toMatchObject({ title: "Link confirmed" });
      await waitFor(() => expect(screen.queryByText("Suggested matches")).not.toBeInTheDocument());
    });
  });
});

describe("given somebody holding only the view grant", () => {
  it("offers no confirm action on a stored suggestion", async () => {
    harness.suggestions = [SUGGESTION];
    renderPage({ permissions: ["governance:view", "activityMonitor:view"] });

    expect(await screen.findByText("Suggested matches")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });
});
