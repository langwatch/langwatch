/**
 * @vitest-environment jsdom
 *
 * Creating, seeing, naming and removing passkeys.
 *
 * `specs/identity/passkeys.feature` carried five settings-facing scenarios and
 * every one of them was tagged `@unimplemented`: the section shipped with no
 * render test at all. These are those scenarios, plus the two the ceremonies
 * turn on — a deployment that never mounted the plugin makes no offer, and a
 * dismissed device prompt says nothing rather than telling somebody off for a
 * decision.
 *
 * WHAT AN OUTCOME MEANS is pinned in `apps/ui/tests/ui-passkeys.unit.test.ts`,
 * where the wire is. What the reader is TOLD about it is here.
 *
 * Spec: specs/identity/passkeys.feature
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing";
import type { FakePersonalHostOptions } from "../../../testing";
import { PasskeysSection } from "../passkeys-section";

vi.mock("../../../behavior/personal-workspace-api", () => ({
  personalWorkspaceApi: {},
  api: {},
}));

const LAPTOP = {
  id: "pk-laptop",
  name: "Work laptop",
  createdAt: "2026-01-04T09:00:00.000Z",
  transports: "internal,hybrid",
};

const KEY = {
  id: "pk-key",
  name: null,
  createdAt: "2026-02-04T09:00:00.000Z",
  transports: "usb",
};

function renderSection(options: FakePersonalHostOptions = {}) {
  const host = fakePersonalWorkspaceHost({
    deployment: {
      isSaas: true,
      appBaseUrl: "https://app.langwatch.ai",
      passkeysEnabled: true,
    },
    ...options,
  });
  renderWithPersonalWorkspaceHost(<PasskeysSection />, { host });
  return host;
}

afterEach(() => cleanup());

describe("given a deployment that never mounted the passkey plugin", () => {
  describe("when the section renders", () => {
    /**
     * There is no endpoint behind any of these controls, so the hero would be
     * an offer we cannot honour.
     */
    /** @scenario A deployment that never mounted passkeys makes no offer */
    it("renders nothing at all", () => {
      renderSection({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
        },
      });

      expect(screen.queryByTestId("passkeys-section")).toBeNull();
    });
  });
});

describe("given an account with no passkeys", () => {
  describe("when the section renders", () => {
    /**
     * An empty list says "you have none of these" to somebody who does not know
     * what they are, and the whole difficulty with passkeys is that most people
     * have never knowingly made one.
     */
    /** @scenario Registering a passkey from settings adds a way in */
    it("explains what one is and offers to make one", async () => {
      renderSection({ passkeys: [] });

      await waitFor(() => expect(screen.getByTestId("passkeys-empty")).toBeTruthy());
      expect(screen.getByText(/fingerprint, face, or screen lock/i)).toBeTruthy();
      expect(screen.getByTestId("create-passkey")).toBeTruthy();
    });
  });

  describe("when the reader creates one", () => {
    /** @scenario Registering a passkey from settings adds a way in */
    it("runs the ceremony and says it worked", async () => {
      const host = renderSection({ passkeys: [] });

      await waitFor(() => expect(screen.getByTestId("create-passkey")).toBeTruthy());
      await userEvent.click(screen.getByTestId("create-passkey"));

      await waitFor(() =>
        expect(host.recording.passkeyCeremonies).toContainEqual({ kind: "register" }),
      );
      expect(host.recording.successes).toContainEqual(
        expect.objectContaining({ title: "Passkey created" }),
      );
    });
  });

  describe("when the reader dismisses the device prompt", () => {
    /**
     * Somebody opened the operating system's dialog, looked at it and closed
     * it. Saying "something went wrong" about a decision is telling them off
     * for deciding.
     */
    /** @scenario A dismissed device prompt is not reported as a failure */
    it("says nothing at all", async () => {
      const host = renderSection({
        passkeys: [],
        passkeyOutcome: { ok: false, cancelled: true },
      });

      await waitFor(() => expect(screen.getByTestId("create-passkey")).toBeTruthy());
      await userEvent.click(screen.getByTestId("create-passkey"));

      await waitFor(() =>
        expect(host.recording.passkeyCeremonies).toContainEqual({ kind: "register" }),
      );
      expect(host.recording.failures).toHaveLength(0);
      expect(host.recording.successes).toHaveLength(0);
    });
  });

  describe("when the device cannot complete the ceremony", () => {
    /** @scenario A ceremony the device could not run says so */
    it("says so, with something to do about it", async () => {
      const host = renderSection({
        passkeys: [],
        passkeyOutcome: { ok: false, cancelled: false },
      });

      await waitFor(() => expect(screen.getByTestId("create-passkey")).toBeTruthy());
      await userEvent.click(screen.getByTestId("create-passkey"));

      await waitFor(() => expect(host.recording.failures).toHaveLength(1));
      expect(host.recording.failures[0]).toEqual(
        expect.objectContaining({
          fallbackTitle: "That passkey wasn't created",
          description: "The attempt didn't finish. Try again, or use another way to sign in.",
        }),
      );
    });
  });
});

describe("given an account holding both kinds of authenticator", () => {
  describe("when the section renders", () => {
    /**
     * Named for where the thing IS, not for what the specification calls it:
     * nobody has ever wanted a "device-bound credential".
     */
    /** @scenario Both kinds of authenticator register, and the list says which */
    it("groups them under headings that say where each one lives", async () => {
      renderSection({ passkeys: [LAPTOP, KEY] });

      await waitFor(() => expect(screen.getByText("Passkeys on your devices")).toBeTruthy());
      expect(screen.getByText("Passkeys on security keys")).toBeTruthy();
      expect(screen.getAllByTestId("passkey-card")).toHaveLength(2);
    });

    /** @scenario A passkey is named, and the name can be changed */
    it("falls back to a word for one the browser did not name", async () => {
      renderSection({ passkeys: [KEY] });

      await waitFor(() => expect(screen.getByText("Passkey")).toBeTruthy());
    });

    /**
     * "Passkeys on security keys (0)" is a heading about an absence, and the
     * page is not a report.
     */
    /** @scenario Both kinds of authenticator register, and the list says which */
    it("shows no heading for a group nothing is in", async () => {
      renderSection({ passkeys: [LAPTOP] });

      await waitFor(() => expect(screen.getByText("Passkeys on your devices")).toBeTruthy());
      expect(screen.queryByText("Passkeys on security keys")).toBeNull();
    });
  });

  describe("when the reader renames one", () => {
    /**
     * A person with three passkeys and no names cannot tell which is the work
     * laptop and which is the phone they no longer own, so they remove none of
     * them.
     */
    /** @scenario A passkey is named, and the name can be changed */
    it("sends the new name for that passkey", async () => {
      const host = renderSection({ passkeys: [LAPTOP] });

      await waitFor(() => expect(screen.getByText("Work laptop")).toBeTruthy());
      await userEvent.click(screen.getByRole("button", { name: "Actions for Work laptop" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
      const input = await screen.findByTestId("passkey-name");
      await userEvent.clear(input);
      await userEvent.type(input, "Home desktop");
      await userEvent.click(screen.getByTestId("save-passkey-name"));

      await waitFor(() =>
        expect(host.recording.passkeyCeremonies).toContainEqual({
          kind: "rename",
          id: "pk-laptop",
          name: "Home desktop",
        }),
      );
    });
  });

  describe("when the reader removes one", () => {
    /**
     * Named in the confirmation, because "Remove?" over a list of three
     * identical-looking cards is not a question anybody can answer.
     */
    /** @scenario Removing a passkey from settings */
    it("names it in the confirmation and removes it once confirmed", async () => {
      const host = renderSection({ passkeys: [LAPTOP] });

      await waitFor(() => expect(screen.getByText("Work laptop")).toBeTruthy());
      await userEvent.click(screen.getByRole("button", { name: "Actions for Work laptop" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));

      expect(await screen.findByText("Remove Work laptop?")).toBeTruthy();
      await userEvent.click(screen.getByTestId("confirm-remove-passkey"));

      await waitFor(() =>
        expect(host.recording.passkeyCeremonies).toContainEqual({
          kind: "remove",
          id: "pk-laptop",
        }),
      );
      expect(host.recording.successes).toContainEqual(
        expect.objectContaining({ title: "Passkey removed" }),
      );
    });

    /** @scenario Removing a passkey from settings */
    it("says the passkey stays on the device until it is deleted there too", async () => {
      renderSection({ passkeys: [LAPTOP] });

      await waitFor(() => expect(screen.getByText("Work laptop")).toBeTruthy());
      await userEvent.click(screen.getByRole("button", { name: "Actions for Work laptop" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));

      expect(await screen.findByText(/stays on your device/i)).toBeTruthy();
    });
  });
});
