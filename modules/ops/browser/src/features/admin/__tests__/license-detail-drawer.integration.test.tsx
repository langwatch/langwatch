/** @vitest-environment jsdom */
/**
 * The license drawer reads the whole reissue chain: which install holds the
 * license, what waits for its next sync, and where a change is signed.
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */
import { nowInstant } from "@langwatch/time";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost } from "../../../testing.tsx";
import type { License } from "../model/license-terms.ts";
import { LicenseDetailDrawer } from "../ui/sections/license-detail-drawer.tsx";

const SIGNED = "eyJleHRlbmRlZCI6dHJ1ZX0=.signature";

function license(overrides: Partial<License> = {}): License {
  return {
    id: "il_1",
    licenseId: "lic-1",
    organizationId: null,
    organizationName: "ACME",
    email: "ops@acme.test",
    planType: "ENTERPRISE",
    maxMembers: 25,
    maxMembersLite: null,
    liteSeatsUnlimited: true,
    maxMembersDeveloper: null,
    issuedAt: "2026-10-01T12:00:00.000Z",
    expiresAt: "2026-12-01T12:00:00.000Z",
    source: "SCRIPT",
    revokedAt: null,
    revokedReason: null,
    supersededAt: null,
    replacesId: null,
    services: [],
    seatRateCents: null,
    seatCurrency: null,
    commitUsdCents: 0,
    overageEnabled: false,
    overageMaxUsdCents: null,
    instanceId: null,
    instanceBoundAt: null,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    status: "active",
    hasPendingDelivery: false,
    ...overrides,
  };
}

const hoursAgo = (hours: number) => nowInstant().subtract({ hours }).toString();

/** A license bound to acme-prod that synced four hours ago with 8 seats in use. */
const bound = (overrides: Partial<License> = {}) =>
  license({
    instanceId: "acme-prod",
    instanceBoundAt: "2026-10-02T09:00:00.000Z",
    lastSyncAt: hoursAgo(4),
    lastSyncVersion: "v3.20.1",
    reportedMembers: 8,
    ...overrides,
  });

/** The replacement a reissue signed for `of`, held until the install presents it. */
const replacementOf = (of: License, overrides: Partial<License> = {}) =>
  license({
    ...of,
    id: "il_2",
    licenseId: "lic-2",
    replacesId: of.id,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    hasPendingDelivery: true,
    expiresAt: "2026-12-15T12:00:00.000Z",
    ...overrides,
  });

const state = vi.hoisted(() => ({
  chain: [] as License[],
  invalidate: vi.fn(),
  reissue: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("../../../behavior/ops-api.ts", () => {
  const idle = () => ({
    mutate: () => {
      throw new Error("an unexpected license command was sent");
    },
    mutateAsync: () => Promise.reject(new Error("an unexpected license command was sent")),
    isPending: false,
  });
  return {
    api: {
      useContext: () => ({ licenseRegistry: { invalidate: state.invalidate } }),
      licenseRegistry: {
        getChain: {
          useQuery: (_input: unknown, opts?: { enabled?: boolean }) => ({
            data: opts?.enabled ? { licenses: state.chain } : undefined,
            error: null,
            isLoading: false,
          }),
        },
        reissue: { useMutation: () => ({ mutateAsync: state.reissue, isPending: false }) },
        revoke: {
          useMutation: () => ({ mutate: vi.fn(), mutateAsync: state.revoke, isPending: false }),
        },
        updateTerms: { useMutation: idle },
        changeSeats: { useMutation: idle },
        resetInstanceBinding: { useMutation: idle },
        linkToOrganization: { useMutation: idle },
        issue: { useMutation: idle },
        registerLegacy: { useMutation: idle },
      },
    },
  };
});

function openDrawer({
  id,
  onRevoke = vi.fn<(license: License) => void>(),
}: {
  id: string;
  onRevoke?: Mock<(license: License) => void>;
}) {
  const host = fakeOpsHost();
  const view = renderWithOpsHost(
    <LicenseDetailDrawer licenseId={id} onClose={vi.fn()} onRevoke={onRevoke} />,
    { host },
  );
  return { host, view, onRevoke };
}

function extendByTwoWeeks() {
  fireEvent.click(screen.getByRole("button", { name: "Extend term" }));
  fireEvent.click(screen.getByRole("button", { name: "+2 weeks" }));
  fireEvent.click(screen.getByRole("button", { name: "Extend to Dec 15, 2026" }));
}

beforeEach(() => {
  state.invalidate.mockReset();
  state.reissue.mockReset();
  state.revoke.mockReset();
  state.reissue.mockResolvedValue({ licenseKey: SIGNED });
  state.revoke.mockResolvedValue({});
});

describe("LicenseDetailDrawer", () => {
  describe("given a license bound to an install that synced this morning", () => {
    beforeEach(() => {
      state.chain = [bound()];
      openDrawer({ id: "il_1" });
    });

    /** @scenario "The drawer opens on the install that holds the license" */
    it("names the install, its last sync, version, seats in use and the next sync", () => {
      const status = screen.getByTestId("license-install-status");
      expect(within(status).getByText("acme-prod")).toBeTruthy();
      expect(status.textContent).toContain("v3.20.1");
      expect(status.textContent).toContain("8 of 25 seats in use");
      expect(status.textContent).toContain("next sync in about 20 hours");
    });
  });

  describe("given a bound trial ending Dec 1", () => {
    let rerender: (next: React.ReactElement) => void;

    beforeEach(() => {
      state.chain = [bound()];
      ({
        view: { rerenderWithOpsHost: rerender },
      } = openDrawer({ id: "il_1" }));
      extendByTwoWeeks();
    });

    /** @scenario "Extending a trial signs a replacement the install picks up on its next sync" */
    it("signs a replacement to Dec 15 with the same seats and shows no key", async () => {
      await waitFor(() => expect(state.reissue).toHaveBeenCalledTimes(1));
      const sent = state.reissue.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent.id).toBe("il_1");
      expect(String(sent.expiresAt).slice(0, 10)).toBe("2026-12-15");
      expect(sent).not.toHaveProperty("maxMembers");
      expect(state.revoke).not.toHaveBeenCalled();

      expect(
        await screen.findByRole("button", { name: "Install can't sync? Show the signed key" }),
      ).toBeTruthy();
      expect(screen.queryByDisplayValue(SIGNED)).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Install can't sync? Show the signed key" }),
      );
      expect(screen.getByDisplayValue(SIGNED)).toBeTruthy();
    });

    /** @scenario "A replacement waiting for delivery shows on the license it replaces" */
    it("says the extension waits for the install once the registry rereads the chain", async () => {
      await waitFor(() => expect(state.invalidate).toHaveBeenCalled());
      state.chain = [replacementOf(bound()), bound()];
      rerender(<LicenseDetailDrawer licenseId="il_1" onClose={vi.fn()} onRevoke={vi.fn()} />);

      const banner = screen.getByTestId("license-delivery-banner");
      expect(banner.textContent).toContain("Extension to Dec 15, 2026 is waiting for acme-prod");
      expect(banner.textContent).toContain("Refresh license");
      const panel = screen.getByTestId("license-panel");
      expect(panel.textContent).toContain("Oct 1, 2026 to Dec 1, 2026 → Dec 15, 2026");
      expect(panel.textContent).toContain("waiting for sync");
    });
  });

  describe("given a replacement with Developer seats waiting for the install", () => {
    /** @scenario "A Developer seat change waiting for delivery shows as waiting for sync" */
    it("shows the Developer seats moving from 0 to 5, waiting for sync", () => {
      state.chain = [replacementOf(bound(), { maxMembersDeveloper: 5 }), bound()];
      openDrawer({ id: "il_1" });

      const panel = screen.getByTestId("license-panel");
      expect(panel.textContent).toContain("0 → 5 Developer");
      expect(panel.textContent).not.toContain("25 → 25 full");
    });
  });

  describe("given a replacement already waiting for the install", () => {
    /** @scenario "Extending again while a replacement waits extends the replacement" */
    it("reissues the replacement, not the license it replaces", async () => {
      state.chain = [replacementOf(bound()), bound()];
      openDrawer({ id: "il_1" });

      fireEvent.click(screen.getByRole("button", { name: "Extend term" }));
      fireEvent.click(screen.getByRole("button", { name: "+1 month" }));
      fireEvent.click(screen.getByRole("button", { name: "Extend to Jan 15, 2027" }));

      await waitFor(() => expect(state.reissue).toHaveBeenCalledTimes(1));
      expect(state.reissue.mock.calls[0]?.[0]).toMatchObject({ id: "il_2" });
    });

    it("opens the revoke on the license in use, not on its replacement", () => {
      const pending = replacementOf(bound());
      state.chain = [pending, bound()];
      const { onRevoke } = openDrawer({ id: "il_1" });

      fireEvent.click(screen.getByRole("button", { name: "Revoke license" }));

      expect(onRevoke).toHaveBeenCalledTimes(1);
      const [inUse] = onRevoke.mock.calls[0] as [License];
      expect(inUse.id).toBe("il_1");
    });
  });

  describe("given a license no install has used", () => {
    let rerender: (next: React.ReactElement) => void;

    beforeEach(() => {
      state.chain = [license()];
      ({
        view: { rerenderWithOpsHost: rerender },
      } = openDrawer({ id: "il_1" }));
      extendByTwoWeeks();
    });

    /** @scenario "Extending a license no install has used shows the new key and stops the unused one" */
    it("shows the new key to send and revokes the unused one", async () => {
      expect(await screen.findByDisplayValue(SIGNED)).toBeTruthy();
      expect(screen.getByTestId("send-key").textContent).toContain("Send this key to the customer");
      expect(state.revoke).toHaveBeenCalledTimes(1);
      expect(state.revoke.mock.calls[0]?.[0]).toMatchObject({ id: "il_1", unusedOnly: true });
    });

    /** @scenario "The signed license stays on screen while its row refreshes" */
    it("keeps the key on screen when the registry rereads the chain", async () => {
      await screen.findByDisplayValue(SIGNED);
      state.chain = [
        replacementOf(license(), { instanceId: null }),
        license({ status: "revoked", revokedAt: hoursAgo(0) }),
      ];
      rerender(<LicenseDetailDrawer licenseId="il_1" onClose={vi.fn()} onRevoke={vi.fn()} />);

      expect(screen.getByDisplayValue(SIGNED)).toBeTruthy();
    });

    it("clears the key when the drawer moves to another license", async () => {
      await screen.findByDisplayValue(SIGNED);
      state.chain = [license({ id: "il_9" })];
      rerender(<LicenseDetailDrawer licenseId="il_9" onClose={vi.fn()} onRevoke={vi.fn()} />);

      expect(screen.queryByDisplayValue(SIGNED)).toBeNull();
    });
  });

  describe("given a license an install bound after the drawer opened", () => {
    /** @scenario "An extension whose unused key an install bound meanwhile keeps the new key for sync" */
    it("reports the refusal and keeps the new key for the install instead of the customer", async () => {
      state.chain = [license()];
      state.revoke.mockRejectedValue(
        Object.assign(new Error("license_in_use"), {
          data: { error: { code: "license_in_use", httpStatus: 409 } },
        }),
      );
      const { host } = openDrawer({ id: "il_1" });

      extendByTwoWeeks();

      expect(
        await screen.findByRole("button", { name: "Install can't sync? Show the signed key" }),
      ).toBeTruthy();
      expect(screen.queryByTestId("send-key")).toBeNull();
      expect(host.recording.failures.map((failure) => failure.fallbackTitle)).toContain(
        "The new key is signed, but the unused one still works: revoke it",
      );
    });
  });

  describe("given retiring the unused key fails for another reason", () => {
    /** The registry after the failure: the replacement and the unused key it replaced, live. */
    const leftOver = () => [
      replacementOf(license({ instanceId: null }), { instanceId: null, hasPendingDelivery: false }),
      license({ instanceId: null }),
    ];

    beforeEach(() => {
      state.chain = [license({ instanceId: null })];
      state.reissue.mockImplementation(async () => {
        state.chain = leftOver();
        return { licenseKey: SIGNED };
      });
      state.revoke.mockRejectedValueOnce(new Error("network down"));
    });

    /** @scenario "Retiring an unused key that failed for another reason keeps the new key for the customer" */
    it("reports the failure and still offers the new key to send to the customer", async () => {
      const { host, view } = openDrawer({ id: "il_1" });

      extendByTwoWeeks();

      expect(await screen.findByTestId("send-key")).toBeTruthy();
      view.rerenderWithOpsHost(
        <LicenseDetailDrawer licenseId="il_1" onClose={vi.fn()} onRevoke={vi.fn()} />,
      );
      expect(host.recording.failures.map((failure) => failure.fallbackTitle)).toContain(
        "The new key is signed, but the unused one still works: revoke it",
      );
      expect(screen.getByTestId("unused-key-left").textContent).toContain(
        "The unused key still works.",
      );
    });

    /** @scenario "An unused key a failed retirement left working can be ended from the drawer" */
    it("ends the unused key on a second try and stops saying it still works", async () => {
      const { view } = openDrawer({ id: "il_1" });
      extendByTwoWeeks();
      await screen.findByTestId("send-key");
      view.rerenderWithOpsHost(
        <LicenseDetailDrawer licenseId="il_1" onClose={vi.fn()} onRevoke={vi.fn()} />,
      );
      await screen.findByTestId("unused-key-left");
      state.revoke.mockImplementation(async ({ id }: { id: string }) => {
        state.chain = state.chain.map((row) =>
          row.id === id ? { ...row, status: "revoked" as const } : row,
        );
        return {};
      });

      fireEvent.click(screen.getByRole("button", { name: "End the unused key" }));

      await waitFor(() =>
        expect(state.revoke).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: "il_1", unusedOnly: true }),
        ),
      );
      view.rerenderWithOpsHost(
        <LicenseDetailDrawer licenseId="il_1" onClose={vi.fn()} onRevoke={vi.fn()} />,
      );
      expect(screen.queryByTestId("unused-key-left")).toBeNull();
    });

    /** @scenario "An unused key left working still shows after the drawer is opened again" */
    it("says the unused key still works when the drawer opens on such a chain", () => {
      state.chain = leftOver();

      openDrawer({ id: "il_2" });

      expect(screen.getByTestId("unused-key-left").textContent).toContain(
        "The unused key still works.",
      );
      expect(screen.getByRole("button", { name: "End the unused key" })).toBeTruthy();
    });
  });

  describe("given an operator picks an end date that does not extend the term", () => {
    /** @scenario "A new end date that does not extend the term cannot be saved" */
    it("disables the save and says the date must be after the current end", () => {
      state.chain = [bound()];
      openDrawer({ id: "il_1" });
      fireEvent.click(screen.getByRole("button", { name: "Extend term" }));
      fireEvent.change(screen.getByLabelText("New end date"), { target: { value: "2026-11-20" } });

      const form = screen.getByTestId("extend-term-form");
      expect(within(form).getByRole("button", { name: "Extend" })).toBeDisabled();
      expect(form.textContent).toContain("The new end date must be after Dec 1, 2026.");
    });
  });

  describe("given the registry refuses the reissue", () => {
    /** @scenario "An extension the registry refuses leaves the term as it was" */
    it("says the license was not extended and keeps the Dec 1 term", async () => {
      state.chain = [bound()];
      state.reissue.mockRejectedValue(new Error("refused"));
      const { host } = openDrawer({ id: "il_1" });

      extendByTwoWeeks();

      await waitFor(() =>
        expect(host.recording.failures.map((failure) => failure.fallbackTitle)).toContain(
          "The license was not extended",
        ),
      );
      expect(screen.getByTestId("license-panel").textContent).toContain(
        "Oct 1, 2026 to Dec 1, 2026",
      );
      expect(screen.queryByRole("button", { name: /Show the signed key/ })).toBeNull();
    });
  });
});
