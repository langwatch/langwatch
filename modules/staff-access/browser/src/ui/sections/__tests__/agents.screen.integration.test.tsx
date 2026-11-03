/**
 * The agents page over an in-memory staff access backend and a stubbed browser passkey.
 * Spec: modules/staff-access/specs/staff-access-pages.feature
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  backend,
  handledError,
  PASSKEY_ASSERTION,
  renderStaffAccess,
  session,
} from "../../../testing.tsx";
import { AgentsContent } from "../agents.screen.tsx";

const passkey = vi.hoisted(() => ({ startAuthentication: vi.fn() }));

vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: passkey.startAuthentication }));
vi.mock("../../../behavior/staff-access-api.ts", async () => ({
  staffAccessApi: (await import("../../../testing.tsx")).fakeStaffAccessApi,
}));

beforeEach(() => {
  backend.reset();
  passkey.startAuthentication.mockReset();
  passkey.startAuthentication.mockResolvedValue(PASSKEY_ASSERTION);
});

describe("given the feature is off", () => {
  beforeEach(() => {
    backend.overviewError = handledError("not_found", 404);
  });

  /** @scenario "The agents page reads as not found while the feature is off" */
  it("reads as not found with no agent controls", () => {
    renderStaffAccess(<AgentsContent />);

    expect(screen.getByTestId("staff-access-not-found")).toHaveTextContent("Page not found");
    expect(screen.queryByTestId("staff-access-enrol-button")).toBeNull();
    expect(screen.queryByTestId("staff-access-revoke-all-button")).toBeNull();
  });
});

describe("given an operator with no passkey", () => {
  beforeEach(() => {
    backend.overview = { hasPasskey: false, requesters: [], sessions: [] };
  });

  /** @scenario "An operator without a passkey is sent to add one before enrolling" */
  it("blocks enrolment and links to where passkeys are added", () => {
    renderStaffAccess(<AgentsContent />);

    expect(screen.getByTestId("staff-access-passkey-required")).toHaveTextContent(
      "Add a passkey before you enrol an agent",
    );
    expect(screen.getByTestId("staff-access-add-passkey-link")).toHaveAttribute(
      "href",
      "/settings/security",
    );
    expect(screen.queryByTestId("staff-access-enrol-button")).toBeNull();
  });
});

describe("given an operator with a passkey", () => {
  it("lists their agents and every operator's sessions", () => {
    renderStaffAccess(<AgentsContent />);

    expect(screen.getAllByTestId("staff-access-requester-row")).toHaveLength(1);
    expect(screen.getByText("laptop agent")).toBeInTheDocument();
    const row = screen.getByTestId("staff-access-session-row");
    expect(within(row).getByText("ACME")).toBeInTheDocument();
    expect(within(row).getByText("olivia@langwatch.ai")).toBeInTheDocument();
    expect(within(row).getByText("Live")).toBeInTheDocument();
  });

  describe("when they enrol an agent", () => {
    /** @scenario "Enrolling an agent shows its requester key and setup command once" */
    it("signs, then shows the key and setup command once", async () => {
      renderStaffAccess(<AgentsContent />);
      await userEvent.click(screen.getByTestId("staff-access-enrol-button"));

      await userEvent.click(await screen.findByTestId("staff-access-enrol-submit"));
      expect(await screen.findByText("Give the agent a name.")).toBeVisible();
      expect(backend.callsTo("enrolOptions")).toEqual([]);

      await userEvent.type(screen.getByTestId("staff-access-enrol-name-input"), "desk agent");
      await userEvent.click(screen.getByTestId("staff-access-enrol-submit"));

      expect(await screen.findByTestId("staff-access-requester-key")).toHaveTextContent(
        "lwsr_lookup123_s3cr3t",
      );
      expect(screen.getByTestId("staff-access-setup-command")).toHaveTextContent(
        "langwatch ops setup --requester-key lwsr_lookup123_s3cr3t",
      );
      expect(screen.getByTestId("staff-access-requester-key-copy")).toBeInTheDocument();
      expect(backend.callsTo("enrol")).toEqual([
        { name: "desk agent", assertion: PASSKEY_ASSERTION },
      ]);

      await userEvent.click(screen.getByTestId("staff-access-enrol-done"));
      await waitFor(() => expect(screen.queryByTestId("staff-access-requester-key")).toBeNull());
      expect(screen.getAllByTestId("staff-access-requester-row")).toHaveLength(2);
    });

    describe("and close the passkey prompt", () => {
      beforeEach(() => {
        passkey.startAuthentication.mockRejectedValue(
          Object.assign(new Error("closed"), { name: "NotAllowedError" }),
        );
      });

      /** @scenario "A cancelled passkey prompt enrols nothing" */
      it("says the check did not finish and enrols nothing", async () => {
        renderStaffAccess(<AgentsContent />);
        await userEvent.click(screen.getByTestId("staff-access-enrol-button"));
        await userEvent.type(
          await screen.findByTestId("staff-access-enrol-name-input"),
          "desk agent",
        );
        await userEvent.click(screen.getByTestId("staff-access-enrol-submit"));

        expect(await screen.findByTestId("staff-access-ceremony-failed")).toHaveTextContent(
          "The passkey check did not finish",
        );
        expect(backend.callsTo("enrol")).toEqual([]);
        expect(screen.queryByTestId("staff-access-requester-key")).toBeNull();
      });
    });
  });

  describe("when they revoke a live session", () => {
    /** @scenario "An operator revokes a live session from the agents page" */
    it("asks to confirm, then shows it revoked", async () => {
      renderStaffAccess(<AgentsContent />);
      const row = screen.getByTestId("staff-access-session-row");
      await userEvent.click(within(row).getByRole("button", { name: "Revoke" }));
      const dialog = await screen.findByRole("alertdialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

      await waitFor(() => expect(within(row).getByText("Revoked")).toBeInTheDocument());
      expect(backend.callsTo("revokeSession")).toEqual([{ requestId: "sar_1" }]);
      expect(within(row).queryByRole("button", { name: "Revoke" })).toBeNull();
    });

    it("offers no revoke on a session that already ended", () => {
      backend.overview = {
        hasPasskey: true,
        requesters: [],
        sessions: [session({ status: "expired" })],
      };
      renderStaffAccess(<AgentsContent />);
      const row = screen.getByTestId("staff-access-session-row");
      expect(within(row).queryByRole("button", { name: "Revoke" })).toBeNull();
    });
  });

  describe("when they use the kill switch", () => {
    /** @scenario "The kill switch needs the typed confirmation" */
    it("revokes nothing until the phrase is typed exactly", async () => {
      renderStaffAccess(<AgentsContent />);
      await userEvent.click(screen.getByTestId("staff-access-revoke-all-button"));

      const input = await screen.findByTestId("staff-access-revoke-all-input");
      await userEvent.type(input, "revoke everything");
      await userEvent.click(screen.getByTestId("staff-access-revoke-all-confirm"));
      expect(await screen.findByText('Type "revoke all" exactly.')).toBeVisible();
      expect(backend.callsTo("revokeAll")).toEqual([]);

      await userEvent.clear(input);
      await userEvent.type(input, "revoke all");
      await userEvent.click(screen.getByTestId("staff-access-revoke-all-confirm"));

      expect(await screen.findByTestId("staff-access-revoke-all-result")).toHaveTextContent(
        "2 sessions were ended",
      );
      expect(backend.callsTo("revokeAll")).toEqual([{ confirmation: "revoke all" }]);
    });
  });
});
