/**
 * The columns a registry row starts at, what a reissue carries over, and how overage terms settle.
 */
import { LicenseOverageMaxRequiresOverageError } from "@langwatch/enterprise-licensing-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { IssuedLicenseRecord } from "../../repositories/issued-license.repository.ts";
import {
  blankIssuedLicenseRow,
  replacementColumns,
  resolveLicenseTerms,
} from "../issued-license-row.rules.ts";

const at = Temporal.Instant.from("2026-01-01T00:00:00Z");

const current: IssuedLicenseRecord = {
  ...blankIssuedLicenseRow(),
  id: "row-1",
  licenseId: "license-1",
  tokenHash: "hash-1",
  organizationId: "org-1",
  organizationName: "Acme",
  email: "ops@example.com",
  planType: "ENTERPRISE",
  maxMembers: 10,
  maxMembersLite: 5,
  issuedAt: at,
  expiresAt: at,
  source: "BACKOFFICE",
  issuedById: "operator-1",
  revokedReason: "kept out of the replacement",
  services: ["gateway"],
  seatRateCents: 1500,
  seatCurrency: "EUR",
  commitUsdCents: 90_000,
  overageEnabled: true,
  overageMaxUsdCents: 10_000,
  instanceId: "instance-1",
  instanceBoundAt: at,
  virtualKeyId: "vk-1",
  createdAt: at,
  updatedAt: at,
};

describe("blankIssuedLicenseRow", () => {
  it("starts every caller-free column empty, unrevoked and without overage", () => {
    expect(blankIssuedLicenseRow()).toStrictEqual({
      revokedAt: null,
      revokedById: null,
      revokedReason: null,
      supersededAt: null,
      replacesId: null,
      pendingDeliveryLicense: null,
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
      virtualKeyId: null,
      seatsRaisedFrom: null,
    });
  });
});

describe("replacementColumns", () => {
  it("carries the commercial terms and the bound install, holding the new key for delivery", () => {
    expect(replacementColumns({ current, held: "signed-key" })).toStrictEqual({
      replacesId: "row-1",
      pendingDeliveryLicense: "signed-key",
      services: ["gateway"],
      seatRateCents: 1500,
      seatCurrency: "EUR",
      commitUsdCents: 90_000,
      overageEnabled: true,
      overageMaxUsdCents: 10_000,
      instanceId: "instance-1",
      instanceBoundAt: at,
    });
  });
});

describe("resolveLicenseTerms", () => {
  it("answers no terms when none were given", () => {
    expect(resolveLicenseTerms({ current, input: undefined })).toStrictEqual({});
  });

  it("refuses an overage maximum while overage stays off", () => {
    expect(() =>
      resolveLicenseTerms({ current: null, input: { overageMaxUsdCents: 500 } }),
    ).toThrow(LicenseOverageMaxRequiresOverageError);
    expect(() =>
      resolveLicenseTerms({
        current,
        input: { overageEnabled: false, overageMaxUsdCents: 500 },
      }),
    ).toThrow(LicenseOverageMaxRequiresOverageError);
  });

  it("clears the maximum when overage is switched off", () => {
    expect(resolveLicenseTerms({ current, input: { overageEnabled: false } })).toStrictEqual({
      overageEnabled: false,
      overageMaxUsdCents: null,
    });
  });

  it("judges a maximum against the overage the license already has", () => {
    expect(resolveLicenseTerms({ current, input: { overageMaxUsdCents: 500 } })).toStrictEqual({
      overageMaxUsdCents: 500,
    });
  });
});
