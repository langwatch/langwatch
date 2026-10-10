import { organizationUserRowSchema } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { organizationFromRecord, userFromRecord } from "../prisma.organization.mapper.ts";

describe("userFromRecord", () => {
  /** @scenario "The member list carries the user's declared columns and no others" */
  it("carries only the declared columns, never the passkey signup claim hash", () => {
    const at = new Date("2026-09-30T00:00:00.000Z");
    const user = userFromRecord({
      id: "user_1",
      name: "Ada",
      email: "ada@example.com",
      emailVerified: true,
      signupConfirmationPending: false,
      passkeySignupClaimHash: "claim-hash",
      image: null,
      pendingSsoSetup: false,
      userHashKey: null,
      twoFactorEnabled: false,
      createdAt: at,
      updatedAt: at,
      lastLoginAt: null,
      deactivatedAt: null,
      lastHomePath: null,
      tracesExplorerTourDismissedAt: null,
      langyCodeAccessPreference: null,
      passkeyNudgeDismissedAt: null,
      joinOfferDismissedDomains: [],
      notificationPreferences: {},
    });

    expect(Object.keys(user).toSorted()).toEqual(
      Object.keys(organizationUserRowSchema.shape).toSorted(),
    );
    expect(user).not.toHaveProperty("passkeySignupClaimHash");
  });
});

describe("organizationFromRecord", () => {
  /** @scenario "An organization read never carries the licence or its dates" */
  it("drops the licence key, its expiry and its validated stamp", () => {
    const at = new Date("2026-09-30T00:00:00.000Z");
    const organization = organizationFromRecord({
      id: "organization_1",
      name: "Acme",
      phoneNumber: null,
      slug: "acme",
      createdAt: at,
      updatedAt: at,
      usageSpendingMaxLimit: null,
      datasetAttachmentMaxMb: null,
      maxSessionDurationDays: 0,
      mfaRequired: false,
      lockoutAfterFailedAttempts: 0,
      lockoutMinutes: 30,
      sessionIdleTimeoutMinutes: 1440,
      sessionMaxLifetimeMinutes: 0,
      signupData: null,
      signedDPA: false,
      elasticsearchNodeUrl: null,
      elasticsearchApiKey: null,
      useCustomElasticsearch: false,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      s3Bucket: null,
      useCustomS3: false,
      sentPlanLimitAlert: null,
      ssoDomain: null,
      ssoProvider: null,
      domainJoin: "request",
      joinDomains: [],
      joinerRole: "MEMBER",
      presenceEnabled: true,
      traceSharingEnabled: true,
      supportContact: null,
      primaryIntent: null,
      promoCode: null,
      stripeCustomerId: null,
      currency: "EUR",
      pricingModel: "TIERED",
      license: "stored-licence",
      licenseExpiresAt: at,
      licenseLastValidatedAt: at,
      selfHostedCustomer: false,
      instantEvalsEnabledAt: null,
      instantEvalsEnabledByUserId: null,
      connectServicesDisabled: [],
      connectLastSyncAt: null,
      connectLastSyncError: null,
    });

    expect(organization).not.toHaveProperty("license");
    expect(organization).not.toHaveProperty("licenseExpiresAt");
    expect(organization).not.toHaveProperty("licenseLastValidatedAt");
  });
});
