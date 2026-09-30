/**
 * @vitest-environment jsdom
 *
 * The backoffice licenses list: what an operator can read off a row without
 * opening it.
 *
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LicensesTable } from "../LicensesTable";
import type { License } from "../types";

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({ licenseRegistry: { invalidate: vi.fn() } }),
    licenseRegistry: {
      revoke: { useMutation: () => ({ mutate: vi.fn() }) },
      resetInstanceBinding: { useMutation: () => ({ mutate: vi.fn() }) },
      updateTerms: { useMutation: () => ({ mutate: vi.fn() }) },
      linkToOrganization: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("~/features/errors", () => ({ showErrorToast: vi.fn() }));

const ISSUED = new Date("2026-09-19T12:00:00.000Z");
const TERM_END = new Date("2027-09-19T12:00:00.000Z");
const SYNCED_AT = new Date("2026-11-02T08:00:00.000Z");

function license(overrides: Partial<License>): License {
  return {
    id: "il_1",
    licenseId: "lic-1",
    tokenHash: "hash",
    organizationId: "org_1",
    organizationName: "ACME Rockets",
    email: "ops@acme.test",
    planType: "ENTERPRISE",
    maxMembers: 50,
    maxMembersLite: 5,
    issuedAt: ISSUED,
    expiresAt: TERM_END,
    source: "BACKOFFICE",
    issuedById: "usr_1",
    revokedAt: null,
    revokedById: null,
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
    virtualKeyId: "vk_1",
    createdAt: ISSUED,
    updatedAt: ISSUED,
    status: "active",
    hasPendingDelivery: false,
    ...overrides,
  } as License;
}

function renderTable(licenses: License[]) {
  render(
    <ChakraProvider value={defaultSystem}>
      <LicensesTable
        licenses={licenses}
        isLoading={false}
        onOpen={vi.fn()}
        onRevoke={vi.fn()}
      />
    </ChakraProvider>,
  );
}

describe("LicensesTable", () => {
  describe("given licenses in the registry that are active, revoked and expired", () => {
    /** @scenario The backoffice lists licenses with their state */
    it("shows the customer, seats, term, status, services and the instance", () => {
      renderTable([
        license({}),
        license({ id: "il_2", status: "revoked", instanceId: null }),
        license({ id: "il_3", status: "expired", services: [] }),
      ]);

      expect(screen.getAllByText("ACME Rockets")).toHaveLength(3);
      expect(screen.getAllByText("ENTERPRISE")).toHaveLength(3);
      expect(screen.getAllByText("50")).toHaveLength(3);
      expect(screen.getAllByText(TERM_END.toLocaleDateString())).toHaveLength(
        3,
      );
      expect(screen.getByText("revoked")).toBeTruthy();
      expect(screen.getByText("expired")).toBeTruthy();
      expect(screen.getAllByText("Instant Evals")).toHaveLength(2);
      expect(screen.getAllByText("bound")).toHaveLength(2);
      expect(screen.getByText("not bound")).toBeTruthy();
    });

    it("says a license that has never synced has not", () => {
      renderTable([license({})]);

      expect(screen.getByText("never synced")).toBeTruthy();
    });
  });

  describe("given a license whose install has synced", () => {
    /** @scenario The backoffice lists licenses with their state */
    it("shows when it last did and the seats it reported", () => {
      renderTable([
        license({
          lastSyncAt: SYNCED_AT,
          lastSyncVersion: "1.42.0",
          reportedMembers: 51,
          reportedMembersLite: 3,
        }),
      ]);

      expect(
        screen.getByText(`${SYNCED_AT.toLocaleDateString()} (1.42.0)`),
      ).toBeTruthy();
      expect(screen.getByText("51 in use")).toBeTruthy();
    });
  });
});
