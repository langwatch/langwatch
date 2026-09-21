/**
 * @vitest-environment jsdom
 *
 * The browsers somebody is signed in on, and ending one of them.
 */

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { BrowserSessionsSection } from "../browser-sessions-section.tsx";

type ListedSession = {
  sessionId: string;
  identifierId: string | null;
  method: string;
  secondFactorProven: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  signedInAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
};

const { state } = vi.hoisted(() => ({
  state: { sessions: [] as ListedSession[], loading: false },
}));

const calls = vi.hoisted(() => ({
  endBrowserSession: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("../../../behavior/personal-workspace-api.ts", () => {
  const api = {
    useUtils: () => ({ user: { browserSessions: { invalidate: calls.invalidate } } }),
    user: {
      browserSessions: {
        useQuery: () => ({ data: state.sessions, isLoading: state.loading }),
      },
      endBrowserSession: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: unknown) => calls.endBrowserSession(input) as unknown,
        }),
      },
    },
  };
  return { personalWorkspaceApi: api, api };
});

const session = (overrides: Partial<ListedSession> = {}): ListedSession => ({
  sessionId: "session-1",
  identifierId: "identifier-1",
  method: "Email and password",
  secondFactorProven: false,
  ipAddress: "203.0.113.4",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  signedInAt: "2026-01-01T00:00:00.000Z",
  lastActiveAt: "2026-01-02T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z",
  current: false,
  ...overrides,
});

beforeEach(() => {
  state.sessions = [];
  state.loading = false;
  calls.endBrowserSession.mockReset();
  calls.invalidate.mockReset();
});

afterEach(() => cleanup());

describe("given the browsers somebody is signed in on", () => {
  describe("when the list has arrived", () => {
    /** @scenario "The account surface serves the browsers somebody is signed in on" */
    it("names the browser and its sign-in method, and marks the one being read from", () => {
      state.sessions = [session(), session({ sessionId: "session-2", current: true })];
      renderWithPersonalWorkspaceHost(<BrowserSessionsSection />, {
        host: fakePersonalWorkspaceHost(),
      });

      const band = within(screen.getByTestId("browser-sessions-section"));
      expect(band.getAllByText(/Chrome on macOS/).length).toBe(2);
      expect(band.getAllByText(/Email and password/).length).toBe(2);
      expect(band.getByText("This browser")).toBeTruthy();
    });

    /** @scenario "The account surface serves the browsers somebody is signed in on" */
    it("points at a browser nobody has used for a fortnight", () => {
      vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
      state.sessions = [session({ lastActiveAt: "2026-01-01T00:00:00.000Z" })];
      renderWithPersonalWorkspaceHost(<BrowserSessionsSection />, {
        host: fakePersonalWorkspaceHost(),
      });

      expect(screen.getByText("Not used lately")).toBeTruthy();
      vi.useRealTimers();
    });
  });

  describe("when somebody ends one of them", () => {
    /** @scenario "Ending one browser session is a mutation on the caller's own account" */
    it("sends only that session's id and re-reads the list", async () => {
      state.sessions = [session(), session({ sessionId: "session-2", current: true })];
      renderWithPersonalWorkspaceHost(<BrowserSessionsSection />, {
        host: fakePersonalWorkspaceHost(),
      });

      const band = within(screen.getByTestId("browser-sessions-section"));
      const buttons = band.getAllByRole("button", { name: "Sign out" });
      expect(buttons.length).toBe(1);
      await userEvent.click(buttons[0]!);

      await waitFor(() => {
        expect(calls.endBrowserSession).toHaveBeenCalledWith({ sessionId: "session-1" });
      });
      expect(calls.invalidate).toHaveBeenCalled();
    });
  });
});
