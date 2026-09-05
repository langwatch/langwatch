/**
 * @vitest-environment jsdom
 *
 * The list of browser sign-ins on the devices tab (D06): what each entry says
 * about how it got in, and how an entry that proved nothing reads.
 *
 * @see specs/identity/mfa-and-session-shape.feature
 * @see specs/ai-gateway/governance/sessions-and-devices.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { listWebSessions } = vi.hoisted(() => ({
  listWebSessions: { data: undefined as unknown, isLoading: false },
}));

vi.mock("~/utils/api", () => ({
  api: {
    personalSessions: {
      listWebSessions: { useQuery: () => listWebSessions },
    },
  },
}));

import { WebSessionsPanel } from "../WebSessionsPanel";

const renderPanel = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <WebSessionsPanel />
    </ChakraProvider>,
  );

afterEach(() => {
  cleanup();
  listWebSessions.data = undefined;
  listWebSessions.isLoading = false;
});

describe("given a person with sessions minted several different ways", () => {
  describe("when they open the list of their signed-in devices", () => {
    /** @scenario "The session list says how each session signed in" */
    /** @scenario "Each web session says how it signed in" */
    it("names the method each one signed in with", () => {
      listWebSessions.data = [
        entry({ sessionId: "s1", method: "Email and password" }),
        entry({ sessionId: "s2", method: "Passkey", secondFactor: true }),
        entry({ sessionId: "s3", method: "Identity provider" }),
      ];

      renderPanel();

      expect(screen.getByText("Email and password")).toBeInTheDocument();
      expect(screen.getByText("Passkey")).toBeInTheDocument();
      expect(screen.getByText("Identity provider")).toBeInTheDocument();
    });

    /** @scenario "The session list says how each session signed in" */
    it("says whether a second factor was proven on each one", () => {
      listWebSessions.data = [
        entry({ sessionId: "s1", method: "Passkey", secondFactor: true }),
        entry({ sessionId: "s2", method: "Email and password" }),
      ];

      renderPanel();

      expect(
        screen.getByText(/Second factor proven at sign-in/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/No second factor at sign-in/),
      ).toBeInTheDocument();
    });

    /** @scenario "The session list says how each session signed in" */
    /** @scenario "A session that recorded nothing reads as an ordinary sign-in" */
    it("reads an entry that proved nothing as a normal sign-in, not a warning", () => {
      listWebSessions.data = [entry({ sessionId: "s1", method: "Signed in" })];

      renderPanel();

      const rows = screen.getAllByTestId("web-session-row");
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      // No alarm words anywhere on it: the overwhelming majority of sessions
      // proved nothing, and telling people their ordinary sign-in is a
      // problem would be false as well as alarming.
      expect(row.textContent ?? "").not.toMatch(
        /warning|insecure|at risk|unsafe|weak/i,
      );
      expect(row).not.toHaveAttribute("role", "alert");
    });

    it("marks the session doing the reading", () => {
      listWebSessions.data = [
        entry({ sessionId: "s1", method: "Passkey", current: true }),
      ];

      renderPanel();

      expect(screen.getByText("This device")).toBeInTheDocument();
    });
  });
});

describe("given a person with no browser sign-ins recorded", () => {
  it("renders nothing rather than an empty heading", () => {
    listWebSessions.data = [];
    const { container } = renderPanel();
    expect(container.textContent).toBe("");
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
    signedInAt: new Date("2026-08-25T00:00:00.000Z").toISOString(),
    expiresAt: new Date("2026-09-25T00:00:00.000Z").toISOString(),
    current,
  };
}
