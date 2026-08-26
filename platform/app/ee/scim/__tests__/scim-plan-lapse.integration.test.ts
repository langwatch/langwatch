// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * @see specs/licensing/management-apis-enterprise-gate.feature
 *
 * A SCIM bearer token is exercised by directory sync for as long as it lives,
 * so the entitlement has to be checked on every call: without that, an
 * organization that leaves Enterprise keeps a working sync indefinitely. This
 * drives the real SCIM Hono app with a real token, first under Enterprise,
 * then after the plan lapses, and asserts the refusal is SCIM-shaped
 * (RFC 7644 error format) and provisions nothing.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { ENTERPRISE_TEST_PLAN } from "~/test-utils/managementApiOrg";
import { seedSsoConnection } from "~/test-utils/ssoConnection";
import { FREE_PLAN } from "../../licensing/constants";
import { app } from "../routes";
import { ScimTokenService } from "../scim-token.service";

const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const CORE_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";

describe("Feature: SCIM entitlement is checked on every call", () => {
  const ns = `scim-lapse-${nanoid(8)}`;

  let organizationId: string;
  let bearerToken: string;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    await resetApp();
    mockGetActivePlan = vi.fn().mockResolvedValue(ENTERPRISE_TEST_PLAN);
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
    });

    const organization = await prisma.organization.create({
      data: { name: "SCIM Lapse Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    // A token names the connection it was issued for (D08), so the directory
    // the identity provider is pushing through has to exist before it can be
    // minted. Which connection is not what this suite is about — the plan is.
    const { connectionId } = await seedSsoConnection({
      prisma,
      organizationId,
    });

    // Minted while the organization is on Enterprise: the credential itself
    // is legitimate for the whole test.
    const minted = await ScimTokenService.create(prisma).generate({
      organizationId,
      connectionId,
      description: "lapse test",
    });
    bearerToken = minted.token;
  });

  afterAll(async () => {
    try {
      await cleanupTestRows(prisma, [
        ["scimRequestLog", { organizationId }],
        ["scimToken", { organizationId }],
        ["ssoConnection", { organizationId }],
        ["organizationUser", { organizationId }],
        ["user", { email: { contains: ns } }],
        ["organization", { id: organizationId }],
      ]);
    } finally {
      // The suite swapped the global app; leaving the mocked plan provider
      // installed would cascade into every later suite of the serial run.
      await resetApp();
    }
  });

  describe("given a SCIM token minted while the organization was on Enterprise", () => {
    /** @scenario A SCIM bearer token stops working when the plan lapses */
    it("serves the identity provider on Enterprise and refuses the same token once the plan lapses", async () => {
      // On Enterprise the token works.
      const entitled = await app.request("/api/scim/v2/Users", {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });
      expect(entitled.status).toBe(200);

      // The plan lapses. The same token is refused, in the SCIM error
      // format the identity provider speaks. 403, not 401: the credential
      // is fine, the account is not, and inviting a retry would be a lie.
      mockGetActivePlan.mockResolvedValue({ ...FREE_PLAN });

      const refused = await app.request("/api/scim/v2/Users", {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });
      expect(refused.status).toBe(403);
      expect(refused.headers.get("content-type")).toContain(
        "application/scim+json",
      );
      const refusedBody = await refused.json();
      expect(refusedBody.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(refusedBody.status).toBe("403");
      expect(refusedBody.detail).toBe(
        "SCIM provisioning requires an Enterprise plan",
      );

      // And nothing is provisioned through the lapsed plan.
      const email = `${ns}-provisioned@example.com`;
      const create = await app.request("/api/scim/v2/Users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/scim+json",
        },
        body: JSON.stringify({
          schemas: [CORE_USER_SCHEMA],
          userName: email,
          name: { givenName: "Never", familyName: "Provisioned" },
          active: true,
        }),
      });
      expect(create.status).toBe(403);
      expect(await prisma.user.findFirst({ where: { email } })).toBeNull();
    });

    it("keeps answering 401 for a token that never existed", async () => {
      mockGetActivePlan.mockResolvedValue(ENTERPRISE_TEST_PLAN);

      const res = await app.request("/api/scim/v2/Users", {
        headers: { Authorization: "Bearer not-a-real-token" },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      // Distinct from the missing-header refusal: an operator debugging a
      // rotated token must not read "required" for a token they did present.
      expect(body.detail).toBe("Bearer token is not valid");
    });
  });

  /**
   * What gets written down about a request, and what deliberately does not
   * (ADR-126 — see specs/identity/scim-request-log.feature).
   *
   * The rule is attribution, and the second half of it is load-bearing: a
   * token that does not verify cannot be filed under an organization, and a
   * table unauthenticated traffic can write is a table anybody on the
   * internet can fill. So the 403 is recorded and the 401 is not, and that
   * asymmetry is asserted here against the real app and the real table
   * rather than described in a comment.
   */
  describe("given requests the app has answered", () => {
    /** @scenario "A refusal we can attribute is recorded as a refusal" */
    it("records a refusal it can attribute, with a reason rather than an error code", async () => {
      mockGetActivePlan.mockResolvedValue(FREE_PLAN);

      await app.request("/api/scim/v2/Users", {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });

      const recorded = await prisma.scimRequestLog.findFirst({
        where: { organizationId, status: 403 },
        orderBy: { occurredAt: "desc" },
      });
      expect(recorded).not.toBeNull();
      expect(recorded?.method).toBe("GET");
      expect(recorded?.resource).toBe("Users");
      // A slug a provisioning tool can branch on, beside our own sentence.
      expect(recorded?.reason).toBe("plan_not_entitled");
    });

    /** @scenario "A request we cannot attribute is answered and not recorded" */
    it("records nothing for a token nothing issued, because there is no anybody to record it for", async () => {
      mockGetActivePlan.mockResolvedValue(ENTERPRISE_TEST_PLAN);
      const before = await prisma.scimRequestLog.count();

      const res = await app.request("/api/scim/v2/Users", {
        headers: { Authorization: "Bearer still-not-a-real-token" },
      });

      expect(res.status).toBe(401);
      // Across the whole table, not just this organization: the point is that
      // the row lands nowhere, not that it lands somewhere else.
      expect(await prisma.scimRequestLog.count()).toBe(before);
    });

    /** @scenario "A request the directory makes is recorded with what we answered" */
    it("records a request it served with the status it answered", async () => {
      mockGetActivePlan.mockResolvedValue(ENTERPRISE_TEST_PLAN);

      await app.request("/api/scim/v2/Users", {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });

      const recorded = await prisma.scimRequestLog.findFirst({
        where: { organizationId, status: 200 },
        orderBy: { occurredAt: "desc" },
      });
      expect(recorded).not.toBeNull();
      expect(recorded?.resource).toBe("Users");
      // Nothing was refused, so there is nothing to call it.
      expect(recorded?.reason).toBeNull();
    });
  });
});
