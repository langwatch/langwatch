/**
 * @vitest-environment jsdom
 *
 * The addresses an account can be reached at: the guard's verdict comes down with
 * the list, so each case is "this verdict in, this control out".
 */

import { webcrypto } from "node:crypto";

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FakePersonalHostOptions } from "../../../testing.tsx";
import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { rememberAddressVerifier } from "../behavior/address-ceremony.ts";
import { refusalCopy } from "../model/refusal-copy.ts";
import { EmailIdentifiersSection } from "../ui/sections/email-identifiers-section.tsx";

const { state, calls } = vi.hoisted(() => ({
  state: { identifiers: [] as unknown[] },
  calls: {
    add: vi.fn(),
    resend: vi.fn(),
    remove: vi.fn(),
    complete: vi.fn(),
    invalidate: vi.fn(),
  },
}));

vi.mock("../../../behavior/personal-workspace-api.ts", () => {
  const mutation = (run: (input: unknown) => unknown) => ({
    useMutation: () => ({ isPending: false, mutateAsync: run }),
  });
  const api = {
    useUtils: () => ({ identity: { myIdentifiers: { invalidate: calls.invalidate } } }),
    identity: {
      myIdentifiers: {
        useQuery: () => ({ data: state.identifiers, isPending: false, error: null }),
      },
      myMethodsLastUsed: {
        useQuery: () => ({ data: { byIdentifier: {}, secondFactorAt: null } }),
      },
      addEmailIdentifier: mutation(calls.add),
      resendIdentifierConfirmation: mutation(calls.resend),
      removeIdentifier: mutation(calls.remove),
      completeVerification: mutation(calls.complete),
    },
  };
  return { personalWorkspaceApi: api, api };
});

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const address = (overrides: Record<string, unknown>) => ({
  identifierId: "id_1",
  accountId: null,
  provider: "email",
  value: "sam@acme.test",
  isPrimary: false,
  confirmed: true,
  resendable: false,
  removable: true,
  refusalCode: null,
  demotesFirst: false,
  ...overrides,
});

function renderSection(options: FakePersonalHostOptions = {}) {
  const host = fakePersonalWorkspaceHost({
    currentUser: { id: "user-1", name: "Sam", email: "sam@acme.test", image: null },
    ...options,
  });
  renderWithPersonalWorkspaceHost(<EmailIdentifiersSection />, { host });
  return host;
}

const rows = () => screen.getAllByTestId("email-identifier-row");

beforeEach(() => {
  vi.clearAllMocks();
  state.identifiers = [];
  calls.add.mockResolvedValue({ identifierId: "id_new" });
  calls.resend.mockResolvedValue({ sent: true });
  calls.remove.mockResolvedValue({ removed: true });
  calls.complete.mockResolvedValue({ verified: true });
  sessionStorage.clear();
});

describe("given one confirmed address and one that was never confirmed", () => {
  beforeEach(() => {
    state.identifiers = [
      address({ identifierId: "confirmed", isPrimary: true }),
      address({
        identifierId: "unconfirmed",
        value: "sam@other.test",
        confirmed: false,
        resendable: true,
      }),
    ];
  });

  describe("when the addresses are listed", () => {
    /** @scenario "Each email address says whether it has been confirmed" */
    it("marks which one is confirmed and which is not", () => {
      renderSection();

      const [confirmed, unconfirmed] = rows();
      expect(within(confirmed!).getByTestId("address-confirmed")).toBeTruthy();
      expect(within(unconfirmed!).getByTestId("address-unconfirmed")).toBeTruthy();
    });

    /** @scenario "A confirmed address offers nothing to resend" */
    it("offers no resend on the confirmed one", () => {
      renderSection();

      expect(within(rows()[0]!).queryByTestId("resend-address-link")).toBeNull();
    });
  });

  describe("when the link is sent again", () => {
    /** @scenario "An unconfirmed address offers to send its link again" */
    it("sends a fresh ceremony and names the address it went to", async () => {
      renderSection();

      fireEvent.click(within(rows()[1]!).getByTestId("resend-address-link"));

      await waitFor(() =>
        expect(calls.resend).toHaveBeenCalledWith(
          expect.objectContaining({ identifierId: "unconfirmed" }),
        ),
      );
      const sent = await screen.findByTestId("address-link-sent");
      expect(sent.textContent).toContain("sam@other.test");
    });
  });
});

describe("given the confirmed address cannot be removed but the unconfirmed one can", () => {
  describe("when the addresses are listed", () => {
    /** @scenario "An address nobody could have signed in with stays removable" */
    it("offers removing the unconfirmed one only", () => {
      state.identifiers = [
        address({
          identifierId: "confirmed",
          removable: false,
          refusalCode: "identity_detach_strands_user",
        }),
        address({
          identifierId: "unconfirmed",
          value: "sam@other.test",
          confirmed: false,
          resendable: true,
        }),
      ];
      renderSection();

      const [confirmed, unconfirmed] = rows();
      expect(within(confirmed!).getByTestId("remove-address")).toBeDisabled();
      expect(within(unconfirmed!).getByTestId("remove-address")).toBeEnabled();
    });
  });
});

describe("given the only confirmed way in is one address", () => {
  beforeEach(() => {
    state.identifiers = [
      address({
        identifierId: "only",
        removable: false,
        refusalCode: "identity_detach_strands_user",
      }),
    ];
  });

  describe("when the addresses are listed", () => {
    /** @scenario "Removing the last confirmed address is refused before it is clicked" */
    it("stands Remove down with the registry's words for the guard's code", () => {
      renderSection();

      expect(screen.getByTestId("remove-address")).toBeDisabled();
      expect(screen.getByTestId("remove-address-blocked")).toBeTruthy();
      const words = refusalCopy("identity_detach_strands_user");
      expect(words).toMatch(/no way back into your account/i);
    });

    /** @scenario "Removing is refused where only passkeys and no address would be left" */
    it("names adding a verified address as the way forward and never sends the removal", () => {
      renderSection();

      fireEvent.click(screen.getByTestId("remove-address"));

      expect(calls.remove).not.toHaveBeenCalled();
      expect(refusalCopy("identity_detach_strands_user")).toMatch(
        /add a verified email address first/i,
      );
    });
  });
});

describe("given two confirmed addresses", () => {
  describe("when one of them is removed", () => {
    /** @scenario "Removing an address that is not the last way in" */
    it("sends the removal and re-reads the list", async () => {
      state.identifiers = [
        address({ identifierId: "primary", isPrimary: true, demotesFirst: true }),
        address({ identifierId: "spare", value: "sam@other.test" }),
      ];
      const host = renderSection();

      fireEvent.click(within(rows()[1]!).getByTestId("remove-address"));

      await waitFor(() => expect(calls.remove).toHaveBeenCalledWith({ identifierId: "spare" }));
      await waitFor(() => expect(calls.invalidate).toHaveBeenCalled());
      expect(host.recording.successes).toContainEqual(
        expect.objectContaining({ title: "Address removed" }),
      );
    });
  });

  describe("when the primary is listed", () => {
    /** @scenario "The primary address says it is demoted before it is removed" */
    it("says another address becomes primary first", () => {
      state.identifiers = [
        address({ identifierId: "primary", isPrimary: true, demotesFirst: true }),
        address({ identifierId: "spare", value: "sam@other.test" }),
      ];
      renderSection();

      expect(rows()[0]!.textContent).toMatch(/makes another confirmed address primary/i);
    });
  });
});

describe("when another address is added", () => {
  /** @scenario "Adding a second address starts a confirmation rather than a sign-in method" */
  it("sends the address with a challenge and says the link is on its way", async () => {
    state.identifiers = [address({ identifierId: "existing" })];
    renderSection();

    fireEvent.click(screen.getByTestId("add-address"));
    fireEvent.change(screen.getByTestId("new-address"), {
      target: { value: "sam@other.test" },
    });
    fireEvent.click(screen.getByTestId("confirm-add-address"));

    await waitFor(() =>
      expect(calls.add).toHaveBeenCalledWith(expect.objectContaining({ email: "sam@other.test" })),
    );
    expect(calls.add.mock.calls[0]![0].codeChallenge).toMatch(/^[A-Za-z0-9._~-]{43}$/);
    expect(sessionStorage.length).toBe(1);
  });
});

describe("given a confirmation link", () => {
  const query = { confirm: "id_new", verification: "verif_1", token: "tok_1" };

  describe("when it is opened in a browser that did not start the ceremony", () => {
    /** @scenario "The confirmation link only completes where the ceremony was started" */
    it("confirms nothing and says where to open it instead", async () => {
      renderSection({ query });

      expect(await screen.findByTestId("address-wrong-browser")).toBeTruthy();
      expect(calls.complete).not.toHaveBeenCalled();
    });
  });

  describe("when it is opened where the ceremony was started", () => {
    it("completes with both proofs and says the address is confirmed", async () => {
      const codeVerifier = "v".repeat(43);
      rememberAddressVerifier({ identifierId: "id_new", codeVerifier });
      renderSection({ query });

      expect(await screen.findByTestId("address-confirmed-now")).toBeTruthy();
      expect(calls.complete).toHaveBeenCalledWith({
        identifierId: "id_new",
        verificationId: "verif_1",
        token: "tok_1",
        codeVerifier,
      });
      expect(sessionStorage.length).toBe(0);
    });
  });
});

describe("given no identifiers yet", () => {
  describe("when the addresses are listed", () => {
    it("still shows the account's own address as the primary one", () => {
      renderSection();

      expect(rows()[0]!.textContent).toContain("sam@acme.test");
      expect(rows()[0]!.textContent).toContain("Primary");
      expect(screen.queryByTestId("remove-address")).toBeNull();
    });
  });
});
