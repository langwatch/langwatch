/** @vitest-environment jsdom */
/**
 * The backoffice licenses list: what an operator reads off a row unopened.
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { License } from "../model/license-terms.ts";
import { LicensesTable } from "../ui/blocks/licenses-table.tsx";

const ISSUED = "2026-09-19T12:00:00.000Z";
const TERM_END = "2027-09-19T12:00:00.000Z";
const SYNCED_AT = "2026-11-02T08:00:00.000Z";

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
    ...overrides,
  };
}

function renderTable(licenses: License[]) {
  render(
    <ChakraProvider value={defaultSystem}>
      <LicensesTable
        licenses={licenses}
        isLoading={false}
        onOpen={vi.fn()}
        onRevoke={vi.fn()}
        onResetBinding={vi.fn()}
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
      expect(screen.getAllByText(new Date(TERM_END).toLocaleDateString())).toHaveLength(3);
      expect(screen.getByText("revoked")).toBeTruthy();
      expect(screen.getByText("expired")).toBeTruthy();
      expect(screen.getAllByText("Instant evals")).toHaveLength(2);
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

      expect(screen.getByText(`${new Date(SYNCED_AT).toLocaleDateString()} (1.42.0)`)).toBeTruthy();
      expect(screen.getByText("51 in use")).toBeTruthy();
    });
  });
});
