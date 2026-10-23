// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Testing licences on LangWatch Cloud (ADR-180 section 2). The `testing_license_token` door
 * verifies the bearer before the body and hands on the user it belongs to, who is asked
 * ops:manage at the platform on every call. Only these routes admit the token.
 */
import { defineRestDoor, defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  issuedTestingLicenseSchema,
  issueTestingLicenseRequestSchema,
  LicensingApi,
  testingLicenseIssuerSchema,
  testingLicenseTokenViewSchema,
} from "@langwatch/enterprise-licensing-contract";

/** An instance id, an organization id and a lifetime; anything larger is not an ask. */
const ISSUE_MAX_BODY_BYTES = 1024;

/** Every token, personal or service, acts as the person who made it (ADR-180 section 2). */
export const testingLicenseDoor = defineRestDoor("testing_license_token", {
  needs: LicensingApi,
  identify: async ({ bearer }, licensing) => {
    const issuer = await licensing.verifyTestingLicenseToken({ bearer });

    return { scope: null, actor: { type: "user", id: issuer.userId }, session: issuer };
  },
});

export const testingLicenseRest = defineRestRouter(LicensingApi)
  .withNamespace("licensing")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("testing_license_token")

  .post("/testing-licenses", "issueTestingLicense")
  .keepsRecords()
  .withAudit("license.issueTesting")
  .withCredential("testing_license_token", { session: testingLicenseIssuerSchema })
  .withInput(issueTestingLicenseRequestSchema)
  .withBodyLimit({ maxBytes: ISSUE_MAX_BODY_BYTES })
  .withPermission("ops:manage", { at: "platform" })
  .withOutput(issuedTestingLicenseSchema)
  .withStatus(201)
  .withDocs({ hide: true })
  .handle(({ input, app, session }) => app.issueTestingLicense({ ...input, issuer: session }))

  // `haven logout` ends its own token here before forgetting it (ADR-180 section 2).
  .delete("/testing-licenses/token", "revokeOwnTestingLicenseToken")
  .withoutConfirmation("only a testing-licence token reaches it, never a Langy key")
  .withAudit("license.revokeTestingToken")
  .withCredential("testing_license_token", { session: testingLicenseIssuerSchema })
  .withPermission("ops:manage", { at: "platform" })
  .withOutput(testingLicenseTokenViewSchema)
  .withDocs({ hide: true })
  .handle(({ app, session }) =>
    app.revokeTestingLicenseToken({ id: session.tokenId, operatorId: session.userId }),
  )
  .build();
