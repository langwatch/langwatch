/**
 * @vitest-environment jsdom
 *
 * Binds langy-baseline.feature scenarios:
 *   - "Open Langy from the handle"
 *   - "Close Langy by clicking outside" (close via the handle is exercised
 *     here; outside-click semantics live one layer up in DashboardLayout
 *     and are deferred to a follow-up that renders the full layout)
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

// Variables controlling useChat's mocked return value, mutable per
// test. Using top-level `let` rather than a vi.fn(...) factory because
// vi.mock is hoisted and would otherwise capture state before the
// `beforeEach` resets run.
let mockStatus: "ready" | "submitted" | "streaming" | "error" = "ready";
let mockStop = vi.fn();
let mockMessages: unknown[] = [];

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: mockMessages,
    sendMessage: vi.fn(),
    stop: mockStop,
    status: mockStatus,
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
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LangyDrawer } from "~/components/langy/LangySidebar";
import { LangyProvider } from "~/components/langy/LangyContext";

function renderDrawer(props: Partial<Parameters<typeof LangyDrawer>[0]> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyProvider>
        <LangyDrawer {...props} />
      </LangyProvider>
    </ChakraProvider>,
  );
}

/**
 * Both the handle and the in-panel close icon use aria-label="Close Langy".
 * The handle renders first in DOM order (LangyDrawer composes <LangyHandle/>
 * before <LangyPanel/>), so getAllByRole(...)[0] is always the handle.
 */
function getHandle(label: RegExp): HTMLElement {
  const buttons = screen.getAllByRole("button", { name: label });
  return buttons[0]!;
}

beforeEach(() => {
  mockStatus = "ready";
  mockStop = vi.fn();
  mockMessages = [];
});

afterEach(() => cleanup());

describe("LangyDrawer", () => {
  describe("given Langy is closed (uncontrolled, initial mount)", () => {
    describe("when the drawer renders", () => {
      it("shows the Langy handle with an 'Open Langy' affordance", () => {
        renderDrawer();
        expect(getHandle(/Open Langy/i)).toBeDefined();
      });
    });

    describe("when the user clicks the handle", () => {
      it("toggles the handle to the 'Close Langy' affordance", async () => {
        renderDrawer();
        await userEvent.click(getHandle(/Open Langy/i));
        expect(getHandle(/Close Langy/i)).toBeDefined();
      });
    });
  });

  describe("given controlled open state", () => {
    describe("when isOpen=false is provided by the parent", () => {
      it("renders the Open affordance on the handle", () => {
        renderDrawer({ isOpen: false });
        expect(getHandle(/Open Langy/i)).toBeDefined();
      });

      it("notifies the parent via onOpenChange(true) when the handle is clicked", async () => {
        const onOpenChange = vi.fn();
        renderDrawer({ isOpen: false, onOpenChange });
        await userEvent.click(getHandle(/Open Langy/i));
        expect(onOpenChange).toHaveBeenCalledWith(true);
      });
    });

    describe("when isOpen=true is provided by the parent", () => {
      it("renders the Close affordance on the handle", () => {
        renderDrawer({ isOpen: true });
        expect(getHandle(/Close Langy/i)).toBeDefined();
      });

      it("notifies the parent via onOpenChange(false) when the handle is clicked", async () => {
        const onOpenChange = vi.fn();
        renderDrawer({ isOpen: true, onOpenChange });
        await userEvent.click(getHandle(/Close Langy/i));
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });

      it("also notifies the parent when the in-panel close icon is clicked", async () => {
        const onOpenChange = vi.fn();
        renderDrawer({ isOpen: true, onOpenChange });
        const closeButtons = screen.getAllByRole("button", {
          name: /Close Langy/i,
        });
        // index 1 is the in-panel close (PanelHeader), since the handle
        // is index 0.
        expect(closeButtons.length).toBeGreaterThanOrEqual(2);
        await userEvent.click(closeButtons[1]!);
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });

  describe("given the panel is open and a response is in flight — binds langy-baseline.feature § Stop an in-flight generation", () => {
    describe("when useChat reports status='streaming'", () => {
      it("renders the Stop control in place of Send", () => {
        mockStatus = "streaming";
        renderDrawer({ isOpen: true });
        expect(
          screen.getByRole("button", { name: /^Stop$/i }),
        ).toBeDefined();
        expect(
          screen.queryByRole("button", { name: /^Send$/i }),
        ).toBeNull();
      });

      it("invokes useChat.stop() when the Stop control is clicked", async () => {
        mockStatus = "streaming";
        renderDrawer({ isOpen: true });
        await userEvent.click(
          screen.getByRole("button", { name: /^Stop$/i }),
        );
        expect(mockStop).toHaveBeenCalledTimes(1);
      });
    });

    describe("when useChat reports status='submitted' (waiting on the model)", () => {
      it("also renders the Stop control — the user can cancel a queued generation", () => {
        mockStatus = "submitted";
        renderDrawer({ isOpen: true });
        expect(
          screen.getByRole("button", { name: /^Stop$/i }),
        ).toBeDefined();
      });
    });

    describe("when useChat returns to status='ready' after stopping", () => {
      it("renders the Send control again", () => {
        mockStatus = "ready";
        renderDrawer({ isOpen: true });
        expect(
          screen.getByRole("button", { name: /^Send$/i }),
        ).toBeDefined();
        expect(
          screen.queryByRole("button", { name: /^Stop$/i }),
        ).toBeNull();
      });
    });
  });

  describe("given the panel is open — binds langy-memory.feature § Stale project memory prompts a refresh", () => {
    function mockProjectMemory(isStale: boolean) {
      const originalFetch = global.fetch;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith("/api/langy/project-memory")) {
          return new Response(
            JSON.stringify({
              memory: { id: "m", projectId: "proj_demo", content: "x" },
              isStale,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // /api/langy/conversations is hit by the recent list; respond empty.
        if (url.startsWith("/api/langy/conversations")) {
          return new Response(JSON.stringify({ conversations: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("", { status: 404 });
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      return () => {
        global.fetch = originalFetch;
      };
    }

    describe("when the server reports isStale=true on mount", () => {
      it("renders a non-blocking stale banner with a link to settings", async () => {
        const restore = mockProjectMemory(true);
        try {
          renderDrawer({ isOpen: true });
          const banner = await screen.findByRole("status", {
            name: /over 30 days old/i,
          });
          expect(banner).toBeDefined();
          const link = screen.getByRole("link", {
            name: /refresh in settings/i,
          });
          expect(link.getAttribute("href")).toBe("/settings/langy-memory");
        } finally {
          restore();
        }
      });

      it("hides the banner after the user clicks dismiss", async () => {
        const restore = mockProjectMemory(true);
        try {
          renderDrawer({ isOpen: true });
          await screen.findByRole("status", { name: /over 30 days old/i });
          await userEvent.click(
            screen.getByRole("button", {
              name: /dismiss stale memory banner/i,
            }),
          );
          expect(
            screen.queryByRole("status", { name: /over 30 days old/i }),
          ).toBeNull();
        } finally {
          restore();
        }
      });
    });

    describe("when the server reports isStale=false on mount", () => {
      it("renders no stale banner", async () => {
        const restore = mockProjectMemory(false);
        try {
          renderDrawer({ isOpen: true });
          // Wait a tick for the fetch effect to resolve.
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(
            screen.queryByRole("status", { name: /over 30 days old/i }),
          ).toBeNull();
        } finally {
          restore();
        }
      });
    });
  });
});
