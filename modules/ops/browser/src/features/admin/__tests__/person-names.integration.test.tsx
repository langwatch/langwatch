/** @vitest-environment jsdom */
/**
 * The token table and the license drawer show people's names, with the id as secondary text.
 * Spec: specs/self-hosting/connected-services/testing-licenses.feature
 */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import type { License } from "../model/license-terms.ts";
import type { TestingLicenseToken } from "../model/testing-license-token.ts";
import { TestingLicenseTokensTable } from "../ui/blocks/testing-license-tokens-table.tsx";
import { LicenseDetailDrawer } from "../ui/sections/license-detail-drawer.tsx";

const byIdState = vi.hoisted(() => ({ current: { data: undefined as License | undefined } }));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useContext: () => ({ licenseRegistry: { invalidate: vi.fn() } }),
    licenseRegistry: {
      getById: {
        useQuery: () => ({ data: byIdState.current.data, error: null, isLoading: false }),
      },
      updateTerms: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      changeSeats: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      resetInstanceBinding: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      linkToOrganization: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      revoke: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      reissue: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      issue: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      registerLegacy: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

function token(overrides: Partial<TestingLicenseToken>): TestingLicenseToken {
  return {
    id: "tlt_1",
    kind: "personal",
    name: null,
    ownerUserId: "user_dev",
    expiresAt: "2027-01-01T00:00:00.000Z",
    revokedAt: null,
    revokedById: null,
    lastUsedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

function license(overrides: Partial<License>): License {
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
    issuedAt: "2026-09-19T12:00:00.000Z",
    expiresAt: "2027-09-19T12:00:00.000Z",
    source: "BACKOFFICE",
    kind: "standard",
    testingOrganizationId: null,
    issuedById: null,
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

describe("ops screens naming people", () => {
  describe("given tokens whose owners are named and gone", () => {
    /** @scenario "Ops screens name the people behind tokens and licenses" */
    it("shows the owner's name with the id, and the id alone when the person is gone", () => {
      renderWithOpsHost(
        <TestingLicenseTokensTable
          isLoading={false}
          onRevoke={vi.fn()}
          tokens={[
            token({ id: "tlt_1", ownerUserId: "user_dev", ownerName: "Dana Developer" }),
            token({ id: "tlt_2", ownerUserId: "user_gone", ownerName: null }),
          ]}
        />,
      );

      expect(screen.getByText("Dana Developer")).toBeTruthy();
      expect(screen.getByLabelText("Copy ID user_dev")).toBeTruthy();
      expect(screen.getByLabelText("Copy ID user_gone")).toBeTruthy();
      expect(screen.queryByText("user_gone")).toBeNull();
    });
  });

  describe("given a license issued by a named person", () => {
    /** @scenario "Ops screens name the people behind tokens and licenses" */
    it("shows the issuer's name in the drawer, for a standard license too", () => {
      byIdState.current.data = license({ issuedById: "user_olive", issuedByName: "Olive Ops" });
      renderWithOpsHost(
        <LicenseDetailDrawer licenseId="il_1" onClose={vi.fn()} onRevoke={vi.fn()} />,
      );

      expect(screen.getByText("Issued by")).toBeTruthy();
      expect(screen.getByText("Olive Ops")).toBeTruthy();
      expect(screen.getByLabelText("Copy ID user_olive")).toBeTruthy();
    });
  });
});
