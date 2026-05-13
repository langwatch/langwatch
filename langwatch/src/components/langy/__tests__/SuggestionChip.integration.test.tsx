/**
 * @vitest-environment jsdom
 *
 * Integration tests for the post-turn suggestion chip (PR-5.2).
 *
 * Binds specs/assistant/langy-proactive.feature:
 *   - "Suggestion renders as a dismissible chip below the assistant message"
 *   - "Click suggestion to act" (kind=ask_followup variant — observable
 *      via the mocked sendMessage)
 *   - "Dismiss a suggestion"
 *   - "Don't show this kind again"
 *   - "Dismissed kinds do not reappear"
 *
 * Boundary mocks: useChat (so we can inject a fake assistant message that
 * carries a langy-suggestion tool output) and global.fetch (so we can observe
 * the GET/PUT to /api/langy/preferences).
 */
import { vi } from "vitest";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const streamWeb = require("node:stream/web") as {
    TransformStream: unknown;
    ReadableStream: unknown;
    WritableStream: unknown;
  };
  if (
    typeof (globalThis as { TransformStream?: unknown }).TransformStream ===
    "undefined"
  ) {
    Object.assign(globalThis, {
      TransformStream: streamWeb.TransformStream,
      ReadableStream:
        (globalThis as { ReadableStream?: unknown }).ReadableStream ??
        streamWeb.ReadableStream,
      WritableStream:
        (globalThis as { WritableStream?: unknown }).WritableStream ??
        streamWeb.WritableStream,
    });
  }
});

let mockMessages: unknown[] = [];
let mockSendMessage = vi.fn();

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: mockMessages,
    sendMessage: mockSendMessage,
    stop: vi.fn(),
    status: "ready" as const,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_demo", slug: "demo" },
    organization: { id: "org_demo" },
    team: { id: "team_demo" },
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LangyDrawer } from "~/components/langy/LangySidebar";
import { LangyProvider } from "~/components/langy/LangyContext";

interface SuggestionAction {
  type: "open_proposal" | "open_url" | "ask_followup";
  proposalId?: string;
  href?: string;
  prompt?: string;
}

function makeSuggestionMessage({
  id = "msg_1",
  kind,
  label,
  rationale,
  action,
}: {
  id?: string;
  kind: string;
  label: string;
  rationale: string;
  action: SuggestionAction;
}) {
  return {
    id,
    role: "assistant" as const,
    parts: [
      { type: "text" as const, text: "Here is the answer." },
      {
        type: "tool-propose_suggestion",
        toolCallId: `${id}__tool`,
        output: {
          langySuggestion: true,
          kind,
          label,
          rationale,
          action,
        },
      },
    ],
  };
}

function setupFetchMock({
  dismissedKindsOnLoad = [] as string[],
} = {}) {
  const putCalls: { body: unknown }[] = [];
  const fetchSpy = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        const method = init?.method ?? "GET";
        if (url.startsWith("/api/langy/preferences") && method === "GET") {
          return new Response(
            JSON.stringify({
              preferences: {
                id: "pref_1",
                userId: "user_1",
                projectId: "proj_demo",
                mode: "non_expert",
                dismissedSuggestionKinds: dismissedKindsOnLoad,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.startsWith("/api/langy/preferences") && method === "PUT") {
          const body = init?.body ? JSON.parse(String(init.body)) : null;
          putCalls.push({ body });
          return new Response(
            JSON.stringify({
              preferences: {
                id: "pref_1",
                userId: "user_1",
                projectId: "proj_demo",
                mode: "non_expert",
                dismissedSuggestionKinds:
                  body?.dismissedSuggestionKinds ?? dismissedKindsOnLoad,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.startsWith("/api/langy/project-memory")) {
          // staleness probe — return a benign 200
          return new Response(JSON.stringify({ isStale: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.startsWith("/api/langy/conversations")) {
          return new Response(
            JSON.stringify({ conversations: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("not-found", { status: 404 });
      },
    );
  return { fetchSpy, putCalls };
}

function renderPanelOpen() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyProvider>
        <LangyDrawer isOpen />
      </LangyProvider>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mockMessages = [];
  mockSendMessage = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Langy suggestion chip", () => {
  describe("given an assistant message that carries a suggestion", () => {
    describe("when the panel renders", () => {
      it("shows the chip with the label and rationale below the assistant message", async () => {
        const { fetchSpy } = setupFetchMock();
        vi.stubGlobal("fetch", fetchSpy);
        mockMessages = [
          makeSuggestionMessage({
            kind: "rerun-stale-experiment",
            label: "Rerun the stale experiment",
            rationale: "It hasn't run in 3 weeks.",
            action: { type: "ask_followup", prompt: "Rerun the experiment" },
          }),
        ];
        renderPanelOpen();
        const chip = await screen.findByTestId("langy-suggestion-chip");
        expect(within(chip).getByText("Rerun the stale experiment")).toBeDefined();
        expect(within(chip).getByText("It hasn't run in 3 weeks.")).toBeDefined();
      });
    });

    describe("when the user clicks the chip body (ask_followup)", () => {
      it("sends the suggested prompt as the next user message", async () => {
        const { fetchSpy } = setupFetchMock();
        vi.stubGlobal("fetch", fetchSpy);
        mockMessages = [
          makeSuggestionMessage({
            kind: "rerun-stale-experiment",
            label: "Rerun the stale experiment",
            rationale: "It hasn't run in 3 weeks.",
            action: { type: "ask_followup", prompt: "Rerun the experiment" },
          }),
        ];
        renderPanelOpen();
        const chip = await screen.findByTestId("langy-suggestion-chip");
        const chipButton = within(chip).getByRole("button", {
          name: "Suggestion: Rerun the stale experiment",
        });
        await userEvent.click(chipButton);
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const call = mockSendMessage.mock.calls[0]!;
        expect((call[0] as { parts: { text: string }[] }).parts[0]?.text).toBe(
          "Rerun the experiment",
        );
      });
    });

    describe("when the user hovers and clicks Dismiss", () => {
      it("hides the chip without writing to preferences", async () => {
        const { fetchSpy, putCalls } = setupFetchMock();
        vi.stubGlobal("fetch", fetchSpy);
        mockMessages = [
          makeSuggestionMessage({
            kind: "rerun-stale-experiment",
            label: "Rerun the stale experiment",
            rationale: "It hasn't run in 3 weeks.",
            action: { type: "ask_followup", prompt: "Rerun" },
          }),
        ];
        renderPanelOpen();
        const chip = await screen.findByTestId("langy-suggestion-chip");
        await userEvent.hover(chip);
        await userEvent.click(
          within(chip).getByRole("button", {
            name: /Dismiss suggestion: Rerun the stale experiment/i,
          }),
        );
        await waitFor(() => {
          expect(screen.queryByTestId("langy-suggestion-chip")).toBeNull();
        });
        expect(putCalls).toHaveLength(0);
      });
    });

    describe("when the user hovers and clicks Don't show again", () => {
      it("PUTs the new kind list to /api/langy/preferences and hides the chip", async () => {
        const { fetchSpy, putCalls } = setupFetchMock();
        vi.stubGlobal("fetch", fetchSpy);
        mockMessages = [
          makeSuggestionMessage({
            kind: "rerun-stale-experiment",
            label: "Rerun the stale experiment",
            rationale: "It hasn't run in 3 weeks.",
            action: { type: "ask_followup", prompt: "Rerun" },
          }),
        ];
        renderPanelOpen();
        const chip = await screen.findByTestId("langy-suggestion-chip");
        await userEvent.hover(chip);
        await userEvent.click(
          within(chip).getByRole("button", {
            name: /Don't show suggestions of kind rerun-stale-experiment again/i,
          }),
        );
        await waitFor(() => {
          expect(putCalls.length).toBe(1);
        });
        const body = putCalls[0]!.body as {
          projectId: string;
          dismissedSuggestionKinds: string[];
        };
        expect(body.projectId).toBe("proj_demo");
        expect(body.dismissedSuggestionKinds).toEqual([
          "rerun-stale-experiment",
        ]);
        await waitFor(() => {
          expect(screen.queryByTestId("langy-suggestion-chip")).toBeNull();
        });
      });
    });
  });

  describe("given the user has previously dismissed this kind via preferences", () => {
    describe("when a fresh suggestion of that kind arrives", () => {
      it("does not render the chip — binds 'Dismissed kinds do not reappear'", async () => {
        const { fetchSpy } = setupFetchMock({
          dismissedKindsOnLoad: ["rerun-stale-experiment"],
        });
        vi.stubGlobal("fetch", fetchSpy);
        mockMessages = [
          makeSuggestionMessage({
            kind: "rerun-stale-experiment",
            label: "Rerun the stale experiment",
            rationale: "It hasn't run in 3 weeks.",
            action: { type: "ask_followup", prompt: "Rerun" },
          }),
        ];
        renderPanelOpen();
        // Wait for the GET /api/langy/preferences round-trip to settle by
        // awaiting any state update. Then verify the chip never appears.
        await waitFor(() => {
          expect(
            fetchSpy.mock.calls.some(([url]) =>
              String(url).startsWith("/api/langy/preferences"),
            ),
          ).toBe(true);
        });
        expect(screen.queryByTestId("langy-suggestion-chip")).toBeNull();
      });
    });
  });
});
