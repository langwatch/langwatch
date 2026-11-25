/**
 * @vitest-environment jsdom
 *
 * The browser sign-ins on the devices tab: what each entry says about how it
 * got in, and how an entry that proved nothing reads.
 * @see specs/ai-gateway/governance/sessions-and-devices.feature
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";

const { listWebSessions } = vi.hoisted(() => ({
  listWebSessions: { data: undefined as unknown, isLoading: false },
}));

vi.mock("../../../behavior/personal-workspace-api.ts", () => {
  const api = { personalSessions: { listWebSessions: { useQuery: () => listWebSessions } } };
  return { personalWorkspaceApi: api, api };
});

import { WebSessionsPanel } from "../web-sessions-panel.tsx";

const renderPanel = () =>
  renderWithPersonalWorkspaceHost(<WebSessionsPanel />, { host: fakePersonalWorkspaceHost() });

afterEach(() => {
  cleanup();
  listWebSessions.data = undefined;
  listWebSessions.isLoading = false;
});

describe("given a person with sessions minted several different ways", () => {
  describe("when they open the list of their signed-in devices", () => {
    /** @scenario "Each web session says how it signed in" */
    it("names the method each one signed in with", () => {
      listWebSessions.data = [
        entry({ sessionId: "s1", method: "Email and password" }),
        entry({ sessionId: "s2", method: "Passkey", secondFactor: true }),
        entry({ sessionId: "s3", method: "Identity provider" }),
      ];

      renderPanel();

      expect(screen.getByText("Browser sign-ins")).toBeTruthy();
      expect(screen.getByText("Email and password")).toBeTruthy();
      expect(screen.getByText("Passkey")).toBeTruthy();
      expect(screen.getByText("Identity provider")).toBeTruthy();
    });

    it("says whether a second factor was proven on each one", () => {
      listWebSessions.data = [
        entry({ sessionId: "s1", method: "Passkey", secondFactor: true }),
        entry({ sessionId: "s2", method: "Email and password" }),
      ];

      renderPanel();

      expect(screen.getByText(/Second factor proven at sign-in/)).toBeTruthy();
      expect(screen.getByText(/No second factor at sign-in/)).toBeTruthy();
    });

    /** @scenario "A session that recorded nothing reads as an ordinary sign-in" */
    it("reads an entry that proved nothing as a normal sign-in, not a warning", () => {
      listWebSessions.data = [entry({ sessionId: "s1", method: "Signed in" })];

      renderPanel();

      const rows = screen.getAllByTestId("web-session-row");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.textContent ?? "").not.toMatch(/warning|insecure|at risk|unsafe|weak/i);
      expect(rows[0]?.getAttribute("role")).not.toBe("alert");
    });

    it("marks the session doing the reading", () => {
      listWebSessions.data = [entry({ sessionId: "s1", method: "Passkey", current: true })];

      renderPanel();

      expect(screen.getByText("This device")).toBeTruthy();
    });
  });
});

describe("given a person with no browser sign-ins recorded", () => {
  it("renders nothing rather than an empty heading", () => {
    listWebSessions.data = [];

    renderPanel();

    expect(screen.queryByText("Browser sign-ins")).toBeNull();
  });
});

function entry({
  sessionId,
  method,
  secondFactor = false,
  current = false,
}: {
  sessionId: string;
  method: string;
  secondFactor?: boolean;
  current?: boolean;
}) {
  return {
    sessionId,
    identifierId: `id_${sessionId}`,
    method,
    secondFactorProven: secondFactor,
    ipAddress: null,
    userAgent: null,
    signedInAt: "2026-08-25T00:00:00.000Z",
    lastActiveAt: "2026-08-25T00:00:00.000Z",
    expiresAt: "2026-09-25T00:00:00.000Z",
    current,
  };
}
