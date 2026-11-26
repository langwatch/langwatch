/** @vitest-environment jsdom */
/**
 * Changing seats from the license drawer: the operator reads what happened
 * and the registry is reread. Spec: specs/self-hosting/connected-services/license-registry.feature
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import type { License } from "../model/license-terms.ts";
import { LicenseDetailDrawer } from "../ui/sections/license-detail-drawer.tsx";

const ISSUED = "2026-09-19T12:00:00.000Z";
const TERM_END = "2027-09-19T12:00:00.000Z";
const SIGNED = "eyJzZWF0cyI6NTh9.signature";

function license(overrides: Partial<License> = {}): License {
  return {
    id: "il_1",
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
    expiresAt: TERM_END,
    source: "BACKOFFICE",
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

type DrawerState = {
  license: License | undefined;
  invalidate: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
};

const state = vi.hoisted((): DrawerState => ({
  license: undefined,
  invalidate: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useContext: () => ({ licenseRegistry: { invalidate: state.invalidate } }),
    licenseRegistry: {
      getChain: {
        useQuery: () => ({
          data: state.license ? { licenses: [state.license] } : undefined,
          error: null,
          isLoading: false,
        }),
      },
      updateTerms: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      resetInstanceBinding: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      linkToOrganization: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      revoke: {
        useMutation: () => ({ mutate: vi.fn(), mutateAsync: state.revoke, isPending: false }),
      },
      issue: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      registerLegacy: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      reissue: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      changeSeats: {
        useMutation: (options?: { onSuccess?: () => Promise<void> }) => ({
          mutate: (
            input: { maxMembers: number },
            opts?: { onSuccess?: (result: unknown) => void },
          ) => {
            const result = {
              licenseKey: SIGNED,
              previousMaxMembers: 50,
              license: license({ id: "il_2", maxMembers: input.maxMembers }),
              billing: "pending",
            };
            void options?.onSuccess?.();
            opts?.onSuccess?.(result);
          },
          isPending: false,
        }),
      },
    },
  },
}));

describe("LicenseDetailDrawer, changing seats", () => {
  describe("given an operator raised the seats of a linked license", () => {
    beforeEach(() => {
      state.invalidate.mockClear();
      state.revoke.mockReset();
      state.revoke.mockResolvedValue({});
      state.license = license();
      renderWithOpsHost(
        <LicenseDetailDrawer licenseId="il_1" onClose={vi.fn()} onRevoke={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Change seats" }));
      fireEvent.change(screen.getByLabelText("Full seats"), { target: { value: "58" } });
      fireEvent.click(screen.getByRole("button", { name: "Change to 58 seats" }));
    });

    /** @scenario "An operator changes the seats of a running license" */
    it("tells the operator billing invoices the added seats, and shows the signed license once", async () => {
      expect(await screen.findByDisplayValue(SIGNED)).toBeTruthy();
      expect(screen.getByTestId("change-seats-result").textContent).toBe(
        "Seats raised from 50 to 58. The install picks the new license up on its next sync or when an admin presses refresh. Billing invoices the added seats, prorated to the end of the term; the Billing section shows the outcome.",
      );
    });

    it("rereads the registry, as main's section did", () => {
      expect(state.invalidate).toHaveBeenCalled();
    });

    it("stops the unused key, since no install holds it", async () => {
      await waitFor(() => expect(state.revoke).toHaveBeenCalledTimes(1));
      expect(state.revoke.mock.calls[0]?.[0]).toMatchObject({ id: "il_1" });
    });
  });
});
