// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SsoSelfServeContext } from "@langwatch/enterprise-sso-contract";
import { describe, expect, it } from "vitest";

import { ssoSelfServeAvailability } from "../sso-self-serve-availability.rules.ts";

const SELF_HOSTED: SsoSelfServeContext = {
  deployment: "self-hosted",
  licensed: true,
  licenseActivatedSinceStart: false,
  optedIn: false,
  singleOrganization: true,
  actorIsPlatformOperator: false,
};

const HOSTED: SsoSelfServeContext = {
  deployment: "hosted",
  licensed: false,
  licenseActivatedSinceStart: false,
  optedIn: true,
  singleOrganization: false,
  actorIsPlatformOperator: false,
};

const proofFor = (context: SsoSelfServeContext) => {
  const availability = ssoSelfServeAvailability(context);
  return availability.available ? availability.proof : null;
};

describe("ssoSelfServeAvailability", () => {
  describe("when the setup surface asks how a domain is proved", () => {
    /** @scenario "The installation decides whether a claimed domain needs published proof" */
    it("proves with the licence on a licensed self-hosted installation with one organization", () => {
      expect(proofFor(SELF_HOSTED)).toBe("license-token");
    });

    it("proves with the licence for a platform operator on an installation with several organizations", () => {
      expect(
        proofFor({ ...SELF_HOSTED, singleOrganization: false, actorIsPlatformOperator: true }),
      ).toBe("license-token");
    });

    it("asks an organization administrator on an installation with several organizations to publish a record", () => {
      expect(proofFor({ ...SELF_HOSTED, singleOrganization: false })).toBe("dns-txt");
    });

    it("always asks for a published record on the hosted service", () => {
      expect(proofFor(HOSTED)).toBe("dns-txt");
      expect(proofFor({ ...HOSTED, singleOrganization: true, actorIsPlatformOperator: true })).toBe(
        "dns-txt",
      );
    });

    it("offers nothing to an unlicensed installation, whoever asks", () => {
      expect(
        ssoSelfServeAvailability({
          ...SELF_HOSTED,
          licensed: false,
          actorIsPlatformOperator: true,
        }),
      ).toEqual({ available: false, refusal: "license_required" });
    });
  });
});
