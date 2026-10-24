/** @vitest-environment jsdom */
/**
 * The Licenses page hides testing licenses until the operator asks for them.
 * Spec: specs/self-hosting/connected-services/testing-licenses.feature
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import type { License } from "../model/license-terms.ts";
import LicensesView from "../ui/sections/licenses-view.tsx";

const ISSUED = "2026-09-19T12:00:00.000Z";
const TERM_END = "2027-09-19T12:00:00.000Z";

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
    issuedAt: ISSUED,
    expiresAt: TERM_END,
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

const standard = license({ id: "il_std", organizationName: "ACME Rockets" });
const testing = license({
  id: "il_test",
  organizationName: "Local dev org",
  kind: "testing",
  testingOrganizationId: "org_local",
  issuedById: "tok_1",
  instanceId: "inst_laptop",
});

const askedWith = vi.hoisted(() => ({ inputs: [] as { includeTesting?: boolean }[] }));

const noMutation = vi.hoisted(() => ({
  useMutation: () => ({ mutate: () => {}, isPending: false }),
}));

/** Stands in for the server: testing rows come back only when asked for. */
vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useContext: () => ({ licenseRegistry: { invalidate: vi.fn() } }),
    licenseRegistry: {
      getAll: {
        useQuery: (input: { includeTesting?: boolean }) => {
          askedWith.inputs.push(input);
          const licenses = input.includeTesting ? [standard, testing] : [standard];
          return {
            data: { licenses, total: licenses.length },
            error: null,
            isLoading: false,
            isFetching: false,
          };
        },
      },
      getById: { useQuery: () => ({ data: undefined, error: null, isLoading: false }) },
      activationCodes: {
        useQuery: () => ({ data: { codes: [], total: 0 }, error: null, isLoading: false }),
      },
      testingLicenseTokens: {
        useQuery: () => ({ data: { tokens: [], total: 0 }, error: null, isLoading: false }),
      },
      revoke: noMutation,
      resetInstanceBinding: noMutation,
      updateTerms: noMutation,
      linkToOrganization: noMutation,
      changeSeats: noMutation,
      reissue: noMutation,
      issue: noMutation,
      registerLegacy: noMutation,
      issueActivationCode: noMutation,
      revokeActivationCode: noMutation,
      createTestingLicenseServiceToken: noMutation,
      revokeTestingLicenseToken: noMutation,
    },
  },
}));

vi.mock("../ui/sections/self-hosted-notices-section.tsx", () => ({
  SelfHostedNoticesSection: () => null,
}));

describe("LicensesView testing licenses", () => {
  beforeEach(() => {
    askedWith.inputs = [];
  });

  describe("given a standard license and a testing license in the registry", () => {
    describe("when an operator opens the license list", () => {
      /** @scenario "Testing licenses are hidden from the license list until asked" */
      it("lists and counts only the standard license, asking the server to leave testing out", () => {
        renderWithOpsHost(<LicensesView />);

        expect(screen.getByText("ACME Rockets")).toBeTruthy();
        expect(screen.queryByText("Local dev org")).toBeNull();
        expect(screen.queryByText("Testing")).toBeNull();
        expect(askedWith.inputs.at(-1)?.includeTesting).toBe(false);
      });
    });

    describe("when the operator asks to include testing licenses", () => {
      /** @scenario "Testing licenses are hidden from the license list until asked" */
      it("lists the testing license with a Testing badge and asks the server for it", async () => {
        renderWithOpsHost(<LicensesView />);

        fireEvent.click(screen.getByLabelText("Show testing licenses"));

        await waitFor(() => expect(screen.getByText("Local dev org")).toBeTruthy());
        expect(screen.getByText("Testing")).toBeTruthy();
        expect(screen.getByText("ACME Rockets")).toBeTruthy();
        expect(askedWith.inputs.at(-1)?.includeTesting).toBe(true);
      });
    });
  });
});
