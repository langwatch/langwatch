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

vi.mock("../../../behavior/ops-api.ts", () => {
  const idle = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    api: {
      useContext: () => ({ licenseRegistry: { invalidate: vi.fn() } }),
      licenseRegistry: {
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

describe("LicenseRevokeDialog", () => {
  describe("given a license whose replacement waits for the install", () => {
    /** @scenario "Revoking from the drawer also revokes the replacement waiting for delivery" */
    it("revokes the replacement first, then the license in use, with the same reason", async () => {
      renderWithOpsHost(
        <LicenseRevokeDialog
          license={row("il_1")}
          chain={[row("il_2"), row("il_1")]}
          onClose={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByRole("textbox"), { target: { value: "contract ended" } });
      fireEvent.click(screen.getByRole("button", { name: "Revoke license" }));

      await waitFor(() => expect(revoke.mutate).toHaveBeenCalledTimes(1));
      expect(revoke.mutateAsync).toHaveBeenCalledWith({ id: "il_2", reason: "contract ended" });
      expect(revoke.mutate.mock.calls[0]?.[0]).toEqual({ id: "il_1", reason: "contract ended" });
    });
  });
});
