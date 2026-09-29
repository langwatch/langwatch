/** @vitest-environment jsdom */
/**
 * Reissuing from the license drawer: the signed key is shown once, stored
 * nowhere. Spec: specs/self-hosting/connected-services/license-registry.feature
 */
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import type { License } from "../model/license-terms.ts";
import { LicenseDetailDrawer } from "../ui/sections/license-detail-drawer.tsx";

const ISSUED = "2026-09-19T12:00:00.000Z";
const TERM_END = "2027-09-19T12:00:00.000Z";
const SIGNED = "eyJyZWlzc3VlZCI6dHJ1ZX0=.signature";

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
    issuedAt: ISSUED,
    expiresAt: TERM_END,
    source: "BACKOFFICE",
    revokedAt: null,
    revokedReason: null,
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

const byIdState = vi.hoisted(() => ({
  current: { data: undefined as License | undefined },
}));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useContext: () => ({ licenseRegistry: { invalidate: vi.fn() } }),
    licenseRegistry: {
      getById: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) =>
          opts?.enabled
            ? { data: byIdState.current.data, error: null, isLoading: false }
            : { data: undefined, error: null, isLoading: false },
      },
      updateTerms: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      changeSeats: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      resetInstanceBinding: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      linkToOrganization: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      revoke: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      issue: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      registerLegacy: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      reissue: {
        useMutation: () => ({
          mutate: (
            _input: unknown,
            opts?: { onSuccess?: (result: { licenseKey: string }) => void },
          ) => {
            opts?.onSuccess?.({ licenseKey: SIGNED });
          },
          isPending: false,
        }),
      },
    },
  },
}));

function reissue() {
  // Both "Change seats" and "Reissue" show a "Seats" field; Reissue's is the
  // second, beside "New term end".
  fireEvent.change(screen.getAllByLabelText("Seats")[1]!, { target: { value: "80" } });
  fireEvent.change(screen.getByLabelText("New term end"), { target: { value: "2028-01-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Reissue license" }));
}

describe("LicenseDetailDrawer, reissuing", () => {
  describe("given an operator reissued a license and the new one is shown", () => {
    let rerenderWithOpsHost: ReturnType<typeof renderWithOpsHost>["rerenderWithOpsHost"];

    beforeEach(() => {
      byIdState.current.data = license();
      ({ rerenderWithOpsHost } = renderWithOpsHost(
        <LicenseDetailDrawer licenseId="il_1" onClose={vi.fn()} onRevoke={vi.fn()} />,
      ));
      reissue();
    });

    /** @scenario The signed license stays on screen while its row refreshes */
    it("keeps it on screen when the registry refetches the same license", () => {
      expect(screen.getByDisplayValue(SIGNED)).toBeTruthy();

      // The refetch the reissue triggered hands the drawer a new object for
      // the same row.
      byIdState.current.data = license({ maxMembers: 80 });
      rerenderWithOpsHost(
        <LicenseDetailDrawer licenseId="il_1" onClose={vi.fn()} onRevoke={vi.fn()} />,
      );

      expect(screen.getByDisplayValue(SIGNED)).toBeTruthy();
    });

    it("clears it when the drawer moves to another license", () => {
      byIdState.current.data = license({ id: "il_2" });
      rerenderWithOpsHost(
        <LicenseDetailDrawer licenseId="il_2" onClose={vi.fn()} onRevoke={vi.fn()} />,
      );

      expect(screen.queryByDisplayValue(SIGNED)).toBeNull();
    });
  });
});
