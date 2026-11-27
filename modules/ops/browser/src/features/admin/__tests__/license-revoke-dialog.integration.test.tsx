/** @vitest-environment jsdom */
/**
 * Revoking a license with a replacement waiting for sync revokes both, so the
 * replacement can never be delivered.
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import type { License } from "../model/license-terms.ts";
import { LicenseRevokeDialog } from "../ui/sections/license-revoke-dialog.tsx";

const revoke = vi.hoisted(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() }));
const chain = vi.hoisted(() => ({ licenses: [] as License[] }));

vi.mock("../../../behavior/ops-api.ts", () => {
  const idle = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    api: {
      useContext: () => ({ licenseRegistry: { invalidate: vi.fn() } }),
      licenseRegistry: {
        getChain: {
          useQuery: (_input: unknown, opts?: { enabled?: boolean }) => ({
            data: opts?.enabled ? { licenses: chain.licenses } : undefined,
            error: null,
            isLoading: false,
            refetch: async () => ({ data: { licenses: chain.licenses } }),
          }),
        },
        revoke: { useMutation: () => ({ ...revoke, isPending: false }) },
        resetInstanceBinding: { useMutation: idle },
        updateTerms: { useMutation: idle },
        linkToOrganization: { useMutation: idle },
        changeSeats: { useMutation: idle },
        reissue: { useMutation: idle },
        issue: { useMutation: idle },
        registerLegacy: { useMutation: idle },
      },
    },
  };
});

const ISSUED = "2026-09-19T12:00:00.000Z";

function row(id: string): License {
  return {
    id,
    licenseId: "lic-1",
    organizationId: "org_1",
    organizationName: "ACME Rockets",
    email: "ops@acme.test",
    planType: "ENTERPRISE",
    maxMembers: 50,
    maxMembersLite: 5,
    liteSeatsUnlimited: false,
    maxMembersDeveloper: null,
    issuedAt: ISSUED,
    expiresAt: "2027-09-19T12:00:00.000Z",
    source: "SCRIPT",
    revokedAt: null,
    revokedReason: null,
    supersededAt: null,
    replacesId: null,
    services: ["instant_evals"],
    seatRateCents: null,
    seatCurrency: null,
    commitUsdCents: 0,
    overageEnabled: false,
    overageMaxUsdCents: null,
    instanceId: "org_install",
    instanceBoundAt: ISSUED,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    status: "active",
    hasPendingDelivery: false,
  };
}

beforeEach(() => {
  revoke.mutate.mockReset();
  revoke.mutateAsync.mockReset();
  revoke.mutateAsync.mockResolvedValue({});
});

function revokeWithReason() {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "contract ended" } });
  fireEvent.click(screen.getByRole("button", { name: "Revoke license" }));
}

describe("LicenseRevokeDialog", () => {
  describe("given a license whose replacement waits for the install", () => {
    /** @scenario "Revoking from the drawer also revokes the replacement waiting for delivery" */
    it("revokes the replacement first, then the license in use, with the same reason", async () => {
      chain.licenses = [row("il_2"), row("il_1")];
      renderWithOpsHost(<LicenseRevokeDialog license={row("il_1")} onClose={vi.fn()} />);

      revokeWithReason();

      await waitFor(() => expect(revoke.mutate).toHaveBeenCalledTimes(1));
      expect(revoke.mutateAsync).toHaveBeenCalledWith({ id: "il_2", reason: "contract ended" });
      expect(revoke.mutate.mock.calls[0]?.[0]).toEqual({ id: "il_1", reason: "contract ended" });
    });

    /** @scenario "Revoking from the table also revokes the license the install still holds" */
    it("revokes the license in use too when the table row is the waiting replacement", async () => {
      chain.licenses = [{ ...row("il_2"), hasPendingDelivery: true }, row("il_1")];
      renderWithOpsHost(<LicenseRevokeDialog license={chain.licenses[0]!} onClose={vi.fn()} />);

      revokeWithReason();

      await waitFor(() => expect(revoke.mutate).toHaveBeenCalledTimes(1));
      expect(revoke.mutateAsync).toHaveBeenCalledWith({ id: "il_1", reason: "contract ended" });
      expect(revoke.mutate.mock.calls[0]?.[0]).toEqual({ id: "il_2", reason: "contract ended" });
    });
  });

  describe("given a replacement signed after the dialog opened", () => {
    /** @scenario "Revoking reaches a replacement signed after the dialog opened" */
    it("reads the chain again on confirm and revokes the new replacement too", async () => {
      chain.licenses = [row("il_2"), row("il_1")];
      renderWithOpsHost(<LicenseRevokeDialog license={row("il_1")} onClose={vi.fn()} />);
      chain.licenses = [row("il_3"), row("il_2"), row("il_1")];

      revokeWithReason();

      await waitFor(() => expect(revoke.mutate).toHaveBeenCalledTimes(1));
      expect(revoke.mutateAsync.mock.calls.map(([input]) => input.id)).toEqual(["il_3", "il_2"]);
      expect(revoke.mutate.mock.calls[0]?.[0]).toEqual({ id: "il_1", reason: "contract ended" });
    });
  });

  describe("given a revoke that failed part way", () => {
    /** @scenario "A revoke that failed part way finishes on retry without repeating a revoked license" */
    it("skips the license already revoked and finishes with the selected one", async () => {
      chain.licenses = [row("il_3"), row("il_2"), row("il_1")];
      const revokedOnServer = async ({ id }: { id: string }) => {
        chain.licenses = chain.licenses.map((license) =>
          license.id === id ? { ...license, status: "revoked" } : license,
        );
        return {};
      };
      revoke.mutateAsync
        .mockImplementationOnce(revokedOnServer)
        .mockRejectedValueOnce(new Error("timeout"));
      renderWithOpsHost(<LicenseRevokeDialog license={row("il_1")} onClose={vi.fn()} />);

      revokeWithReason();
      await waitFor(() => expect(revoke.mutateAsync).toHaveBeenCalledTimes(2));
      expect(revoke.mutate).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Revoke license" }));

      await waitFor(() => expect(revoke.mutate).toHaveBeenCalledTimes(1));
      expect(revoke.mutateAsync.mock.calls.map(([input]) => input.id)).toEqual([
        "il_3",
        "il_2",
        "il_2",
      ]);
      expect(revoke.mutate.mock.calls[0]?.[0]).toEqual({ id: "il_1", reason: "contract ended" });
    });
  });
});
