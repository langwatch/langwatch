// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Testing licences on LangWatch Cloud (ADR-180 section 2). The `testing_license_token` door
 * verifies the bearer before the body; ops:manage at the platform is asked of a personal
 * token's person on every call, and a service token stands alone. No other route admits it.
 */
import { defineRestDoor, defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  issuedTestingLicenseSchema,
  issueTestingLicenseRequestSchema,
  LicensingApi,
  testingLicenseIssuerSchema,
} from "@langwatch/enterprise-licensing-contract";

/** An instance id, an organization id and a lifetime; anything larger is not an ask. */
const ISSUE_MAX_BODY_BYTES = 1024;

/** A personal token acts as its person; a service token acts as no person (ADR-180 section 2). */
export const testingLicenseDoor = defineRestDoor("testing_license_token", {
  needs: LicensingApi,
  identify: async ({ bearer }, licensing) => {
    const issuer = await licensing.verifyTestingLicenseToken({ bearer });

    return {
      scope: null,
      actor: issuer.kind === "personal" ? { type: "user", id: issuer.userId } : null,
      session: issuer,
    };
  },
});

export const testingLicenseRest = defineRestRouter(LicensingApi)
  .withNamespace("licensing")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("testing_license_token")

  .post("/testing-licenses", "issueTestingLicense")
  .withAudit("license.issueTesting")
  .withCredential("testing_license_token", { session: testingLicenseIssuerSchema })
  .withInput(issueTestingLicenseRequestSchema)
  .withBodyLimit({ maxBytes: ISSUE_MAX_BODY_BYTES })
  .withPermission("ops:manage", { at: "platform" })
  .withOutput(issuedTestingLicenseSchema)
  .withStatus(201)
  .withDocs({ hide: true })
  .handle(({ input, app, session }) => app.issueTestingLicense({ ...input, issuer: session }))
  .build();
