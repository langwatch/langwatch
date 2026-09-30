// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One read for the setup page: identity folds where the journey stands, this
 * module adds the addresses it is the one serving.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { SsoSetupApi, SsoSetupView } from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createSsoTestApp,
  createSsoTestFeatureFlags,
  createSsoTestIdentity,
  RecordingSsoConnectionLedger,
} from "./sso.fixture.ts";

const ORGANIZATION = "organization-1";

function journeyOf(connection: SsoSetupView["connection"]): SsoSetupView {
  return {
    connection,
    claims: [],
    record: null,
    goLive: null,
    legacyRoute: null,
    migration: null,
  };
}

const registered: SsoSetupView["connection"] = {
  connectionId: "connection-1",
  state: "VERIFIED",
  type: "oidc",
  providerId: "okta",
  issuer: "https://acme.okta.com",
  source: "self-serve",
  arrivalPolicy: "refuse",
  arrivalPolicyDecidedAtMs: null,
  tearDownAfterMs: null,
  createdAtMs: 1_700_000_000_000,
  verifiedDomains: ["acme.test"],
  domainProofs: [],
};

async function appReading(
  connection: SsoSetupView["connection"],
  { optedIn = true }: { optedIn?: boolean } = {},
) {
  const getSetup = vi.fn<SsoSetupApi["getSetup"]>(async () => journeyOf(connection));
  const app = await createSsoTestApp({
    members: { isSaas: optedIn },
    dependencies: {
      featureFlags: createSsoTestFeatureFlags(optedIn ? [ORGANIZATION] : []),
      identity: createSsoTestIdentity({
        connections: RecordingSsoConnectionLedger.create(),
        setup: createApiFixture<SsoSetupApi>({ getSetup }),
      }),
    },
  });

  return { app, getSetup };
}

describe("reading where an organization's setup stands", () => {
  /** @scenario "The setup read carries the addresses an identity provider is pointed at" */
  it("asks identity for the journey and answers the addresses beside it", async () => {
    const { app, getSetup } = await appReading(registered);
    const setup = await app.getSetup({ organizationId: ORGANIZATION });

    expect(getSetup).toHaveBeenCalledWith({ organizationId: ORGANIZATION });
    expect(setup.connection?.connectionId).toBe("connection-1");
    expect(setup.serviceProvider.redirectUrl).toBe(
      "https://acme.test/api/auth/sso/callback/connection-1",
    );
    expect(setup.serviceProvider.entityId).toBe("https://acme.test/api/auth/sso/saml2/sp");
    expect(setup.availability).toEqual({ available: true });
  });

  /** @scenario "Before a connection exists the addresses show their shape" */
  it("shows the shape of the addresses before anything is registered", async () => {
    const { app } = await appReading(null);
    const setup = await app.getSetup({ organizationId: ORGANIZATION });

    expect(setup.connection).toBeNull();
    expect(setup.serviceProvider.redirectUrl).toBe(
      "https://acme.test/api/auth/sso/callback/{connection}",
    );
  });

  it("answers why setup is refused where the installation holds no licence", async () => {
    const { app } = await appReading(null, { optedIn: false });
    const setup = await app.getSetup({ organizationId: ORGANIZATION });

    expect(setup.availability).toEqual({ available: false, refusal: "license_required" });
  });
});
