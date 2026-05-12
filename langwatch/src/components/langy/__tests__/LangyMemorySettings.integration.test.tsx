/**
 * @vitest-environment jsdom
 *
 * Integration tests for LangyMemorySettings (PR-2.5).
 * Spec: specs/assistant/langy-memory.feature (L4 + privacy sections).
 * Issue: #3955 (Phase 2). Epic: #3960.
 *
 * Boundary mocks: useOrganizationTeamProject (project + permissions),
 * global.fetch (observable). No DB, no MSW.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const orgRef = {
  current: {
    project: { id: "project-demo", slug: "demo" },
    hasPermission: (_p: string) => true,
  },
};

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => orgRef.current,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: () => false,
}));

// Chakra v3 Switch wraps an Ark Toggle whose state machine doesn't react
// straightforwardly to userEvent.click in jsdom; the rest of the codebase
// stubs it as a plain checkbox in tests for this reason
// (see src/tests/settings/annotation-scores.lite-member.integration.test.tsx).
vi.mock("~/components/ui/switch", () => ({
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
    children,
  }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (details: { checked: boolean }) => void;
    children?: React.ReactNode;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) =>
          onCheckedChange?.({ checked: (e.target as HTMLInputElement).checked })
        }
      />
      {children}
    </label>
  ),
}));

import { LangyMemorySettings } from "../LangyMemorySettings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

interface FetchScenario {
  memory: {
    id: string;
    projectId: string;
    content: string;
    contentVersion: number;
    refreshedAt: string;
    updatedAt: string;
  } | null;
  conversations: Array<{
    id: string;
    title: string | null;
    lastActivityAt: string;
  }>;
  exportPayload?: unknown;
  putShouldFail?: boolean;
  isStale?: boolean;
  preferences?: {
    id: string;
    userId: string;
    projectId: string;
    mode: "non_expert" | "expert";
    dismissedSuggestionKinds: string[];
  };
}

function installFetchMock(scenario: FetchScenario): Mock {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.startsWith("/api/langy/project-memory") && method === "GET") {
      return new Response(
        JSON.stringify({
          memory: scenario.memory,
          isStale: scenario.isStale ?? false,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.startsWith("/api/langy/project-memory") && method === "PUT") {
      if (scenario.putShouldFail) {
        return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return new Response(
        JSON.stringify({
          memory: {
            ...(scenario.memory ?? {}),
            content: body.content,
            contentVersion: (scenario.memory?.contentVersion ?? 0) + 1,
            updatedAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/project-memory/refresh") && method === "POST") {
      return new Response(
        JSON.stringify({
          memory: {
            ...(scenario.memory ?? {}),
            content: "refreshed content",
            refreshedAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.startsWith("/api/langy/conversations") && method === "GET") {
      return new Response(
        JSON.stringify({ conversations: scenario.conversations }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.startsWith("/api/langy/conversations/") && method === "DELETE") {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url.startsWith("/api/langy/memory/export") && method === "GET") {
      return new Response(
        JSON.stringify(scenario.exportPayload ?? { conversations: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.startsWith("/api/langy/memory") && method === "DELETE") {
      return new Response(JSON.stringify({ deletedCount: 3 }), { status: 200 });
    }
    if (url.startsWith("/api/langy/preferences") && method === "GET") {
      return new Response(
        JSON.stringify({
          preferences: scenario.preferences ?? {
            id: "pref-1",
            userId: "user-1",
            projectId: "project-demo",
            mode: "non_expert",
            dismissedSuggestionKinds: [],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.startsWith("/api/langy/preferences") && method === "PUT") {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return new Response(
        JSON.stringify({
          preferences: {
            id: "pref-1",
            userId: "user-1",
            projectId: body.projectId,
            mode: body.mode ?? "non_expert",
            dismissedSuggestionKinds: body.dismissedSuggestionKinds ?? [],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("not stubbed", { status: 501 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseMemory = {
  id: "mem-1",
  projectId: "project-demo",
  content: "demo project memory content",
  contentVersion: 1,
  refreshedAt: "2026-05-01T10:00:00.000Z", // recent
  updatedAt: "2026-05-01T10:00:00.000Z",
};

function renderSettings() {
  return render(<LangyMemorySettings />, { wrapper: Wrapper });
}

beforeEach(() => {
  orgRef.current = {
    project: { id: "project-demo", slug: "demo" },
    hasPermission: () => true,
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LangyMemorySettings", () => {
  describe("given a project with existing memory", () => {
    describe("when the page mounts", () => {
      it("fetches the project memory with the current projectId", async () => {
        const fetchMock = installFetchMock({
          memory: baseMemory,
          conversations: [],
        });
        renderSettings();
        await waitFor(() => {
          const call = fetchMock.mock.calls.find(([url]) =>
            String(url).startsWith("/api/langy/project-memory"),
          );
          expect(call).toBeTruthy();
          expect(String(call![0])).toContain("projectId=project-demo");
        });
      });

      it("renders the memory content in the editor", async () => {
        installFetchMock({ memory: baseMemory, conversations: [] });
        renderSettings();
        const editor = await screen.findByRole("textbox", {
          name: /project memory/i,
        });
        expect(editor).toHaveValue("demo project memory content");
      });
    });
  });

  describe("given the user is a project admin", () => {
    beforeEach(() => {
      orgRef.current = {
        project: { id: "project-demo", slug: "demo" },
        hasPermission: (p: string) => p === "project:manage",
      };
    });

    describe("when the admin edits and saves", () => {
      it("PUTs the updated content to /api/langy/project-memory", async () => {
        const fetchMock = installFetchMock({
          memory: baseMemory,
          conversations: [],
        });
        renderSettings();
        const editor = await screen.findByRole("textbox", {
          name: /project memory/i,
        });
        await userEvent.clear(editor);
        await userEvent.type(editor, "new content");
        await userEvent.click(screen.getByRole("button", { name: /save/i }));
        await waitFor(() => {
          const put = fetchMock.mock.calls.find(
            ([url, init]) =>
              String(url).startsWith("/api/langy/project-memory") &&
              (init?.method ?? "GET").toUpperCase() === "PUT",
          );
          expect(put).toBeTruthy();
          const body = JSON.parse(String(put![1]!.body));
          expect(body.content).toBe("new content");
          expect(body.projectId).toBe("project-demo");
        });
      });
    });

    describe("when the admin clicks Refresh", () => {
      it("POSTs to /api/langy/project-memory/refresh", async () => {
        const fetchMock = installFetchMock({
          memory: baseMemory,
          conversations: [],
        });
        renderSettings();
        await screen.findByRole("textbox", { name: /project memory/i });
        await userEvent.click(
          screen.getByRole("button", { name: /refresh from project/i }),
        );
        await waitFor(() => {
          const post = fetchMock.mock.calls.find(
            ([url, init]) =>
              String(url).includes("/project-memory/refresh") &&
              (init?.method ?? "GET").toUpperCase() === "POST",
          );
          expect(post).toBeTruthy();
        });
      });
    });
  });

  describe("given the user is not a project admin", () => {
    beforeEach(() => {
      orgRef.current = {
        project: { id: "project-demo", slug: "demo" },
        hasPermission: () => false,
      };
    });

    describe("when the page renders", () => {
      it("disables the Save button", async () => {
        installFetchMock({ memory: baseMemory, conversations: [] });
        renderSettings();
        const save = await screen.findByRole("button", { name: /save/i });
        expect(save).toBeDisabled();
      });

      it("disables the Refresh button", async () => {
        installFetchMock({ memory: baseMemory, conversations: [] });
        renderSettings();
        const refresh = await screen.findByRole("button", {
          name: /refresh from project/i,
        });
        expect(refresh).toBeDisabled();
      });
    });
  });

  describe("given project memory is older than 30 days", () => {
    describe("when the page mounts", () => {
      it("shows a non-blocking stale banner", async () => {
        const staleDate = new Date(
          Date.now() - 31 * 24 * 60 * 60 * 1000,
        ).toISOString();
        installFetchMock({
          memory: { ...baseMemory, refreshedAt: staleDate },
          conversations: [],
          isStale: true,
        });
        renderSettings();
        expect(
          await screen.findByText(/memory is over 30 days old/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given the user has conversations in this project", () => {
    const conversations = [
      { id: "c1", title: "Chat A", lastActivityAt: "2026-05-10T10:00:00.000Z" },
      { id: "c2", title: "Chat B", lastActivityAt: "2026-05-09T10:00:00.000Z" },
    ];

    describe("when the page mounts", () => {
      it("lists the user's conversations under privacy controls", async () => {
        installFetchMock({ memory: baseMemory, conversations });
        renderSettings();
        const list = await screen.findByRole("list", {
          name: /your conversations/i,
        });
        const items = within(list).getAllByRole("listitem");
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent(/Chat A/);
      });
    });

    describe("when the user deletes a single conversation", () => {
      it("calls DELETE /api/langy/conversations/:id", async () => {
        const fetchMock = installFetchMock({
          memory: baseMemory,
          conversations,
        });
        renderSettings();
        const list = await screen.findByRole("list", {
          name: /your conversations/i,
        });
        const firstItem = within(list).getAllByRole("listitem")[0]!;
        await userEvent.click(
          within(firstItem).getByRole("button", { name: /delete/i }),
        );
        await waitFor(() => {
          const del = fetchMock.mock.calls.find(
            ([url, init]) =>
              String(url).includes("/conversations/c1") &&
              (init?.method ?? "GET").toUpperCase() === "DELETE",
          );
          expect(del).toBeTruthy();
        });
      });
    });

    describe("when the user clicks 'Clear all my memory' and confirms", () => {
      it("calls DELETE /api/langy/memory with the projectId", async () => {
        const fetchMock = installFetchMock({
          memory: baseMemory,
          conversations,
        });
        renderSettings();
        await screen.findByRole("textbox", { name: /project memory/i });
        await userEvent.click(
          screen.getByRole("button", { name: /clear all my memory/i }),
        );
        // Confirm
        await userEvent.click(
          await screen.findByRole("button", { name: /^confirm clear$/i }),
        );
        await waitFor(() => {
          const del = fetchMock.mock.calls.find(
            ([url, init]) =>
              String(url).startsWith("/api/langy/memory?") &&
              !String(url).includes("/memory/export") &&
              (init?.method ?? "GET").toUpperCase() === "DELETE",
          );
          expect(del).toBeTruthy();
          expect(String(del![0])).toContain("projectId=project-demo");
        });
      });
    });

    describe("when the user clicks 'Download my data'", () => {
      it("fetches /api/langy/memory/export with the projectId", async () => {
        const fetchMock = installFetchMock({
          memory: baseMemory,
          conversations,
          exportPayload: { conversations: ["sample"] },
        });
        // jsdom doesn't support real download anchor click; just verify the fetch fires.
        renderSettings();
        await screen.findByRole("textbox", { name: /project memory/i });
        await userEvent.click(
          screen.getByRole("button", { name: /download my data/i }),
        );
        await waitFor(() => {
          const exp = fetchMock.mock.calls.find(([url]) =>
            String(url).startsWith("/api/langy/memory/export"),
          );
          expect(exp).toBeTruthy();
          expect(String(exp![0])).toContain("projectId=project-demo");
        });
      });
    });
  });

  describe("given the mode toggle — binds langy-baseline.feature § Switch to expert mode (UI half)", () => {
    describe("when the user flips Expert mode on", () => {
      it("PUTs mode=expert to /api/langy/preferences", async () => {
        const fetchMock = installFetchMock({
          memory: baseMemory,
          conversations: [],
        });
        renderSettings();
        const toggle = await screen.findByRole("checkbox", {
          name: /expert mode/i,
        });
        await userEvent.click(toggle);

        await waitFor(() => {
          const put = fetchMock.mock.calls.find(
            ([url, init]) =>
              String(url).startsWith("/api/langy/preferences") &&
              (init as RequestInit | undefined)?.method === "PUT",
          );
          expect(put).toBeTruthy();
          const body = JSON.parse(
            String((put![1] as RequestInit).body),
          ) as { projectId: string; mode: string };
          expect(body.mode).toBe("expert");
          expect(body.projectId).toBe("project-demo");
        });
      });
    });

    describe("when the PUT fails", () => {
      it("reverts the toggle to its previous state", async () => {
        // Custom fetch mock that 500s on PUT /api/langy/preferences.
        const fetchMock = vi.fn(
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input.toString();
            const method = (init?.method ?? "GET").toUpperCase();
            if (
              url.startsWith("/api/langy/preferences") &&
              method === "GET"
            ) {
              return new Response(
                JSON.stringify({
                  preferences: {
                    id: "pref-1",
                    userId: "user-1",
                    projectId: "project-demo",
                    mode: "non_expert",
                    dismissedSuggestionKinds: [],
                  },
                }),
                { status: 200 },
              );
            }
            if (
              url.startsWith("/api/langy/preferences") &&
              method === "PUT"
            ) {
              return new Response(JSON.stringify({ error: "boom" }), {
                status: 500,
              });
            }
            if (url.startsWith("/api/langy/project-memory")) {
              return new Response(
                JSON.stringify({ memory: baseMemory, isStale: false }),
                { status: 200 },
              );
            }
            if (url.startsWith("/api/langy/conversations")) {
              return new Response(JSON.stringify({ conversations: [] }), {
                status: 200,
              });
            }
            return new Response("not stubbed", { status: 501 });
          },
        );
        vi.stubGlobal("fetch", fetchMock);

        renderSettings();
        const toggle = (await screen.findByRole("checkbox", {
          name: /expert mode/i,
        })) as HTMLInputElement;
        // Initial state: non-expert.
        expect(toggle.checked).toBe(false);
        await userEvent.click(toggle);

        // PUT 500s → optimistic update is rolled back to unchecked.
        await waitFor(
          () => {
            expect(toggle.checked).toBe(false);
          },
          { timeout: 3000 },
        );
      });
    });
  });
});
