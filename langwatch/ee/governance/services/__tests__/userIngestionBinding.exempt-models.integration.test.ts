/**
 * @vitest-environment node
 *
 * Regression coverage for the EXEMPT_MODELS multitenancy guard for the
 * new IngestionTemplate + UserIngestionBinding models. Mirrors
 * `feedback_new_org_scoped_models_exempt.md`: if either model drifts
 * out of EXEMPT_MODELS in a future refactor, every query that doesn't
 * carry a projectId throws "requires projectId" — this test pins the
 * shape so the regression fires in CI rather than at runtime.
 *
 * The IngestionTemplate query walks by organizationId (admin
 * tenancy view); the UserIngestionBinding query walks by userId
 * (admin / user-side view). Neither carries projectId; both must
 * succeed without the multitenancy middleware throwing.
 *
 * NOT a behavior test — just an assertion that the prisma calls
 * complete normally. Service-layer auth is exercised in the dedicated
 * service integration tests.
 *
 * Spec:
 *   specs/ai-gateway/governance/user-ingestion-binding-lifecycle.feature
 *   specs/ai-gateway/governance/ingestion-templates-catalog.feature
 */
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import { prisma } from "~/server/db";

describe("EXEMPT_MODELS — IngestionTemplate / UserIngestionBinding", () => {
  describe("when querying IngestionTemplate by organizationId without projectId", () => {
    it("does not throw 'requires projectId' from the multitenancy middleware", async () => {
      // No matching row required — the assertion is that the prisma
      // call returns (null) rather than throwing the multitenancy error.
      await expect(
        prisma.ingestionTemplate.findFirst({
          where: { organizationId: `org-${nanoid(8)}` },
        }),
      ).resolves.toBeNull();
    });

    it("does not throw when querying platform-default rows (organizationId IS NULL)", async () => {
      await expect(
        prisma.ingestionTemplate.findFirst({
          where: { organizationId: null, slug: `nope-${nanoid(8)}` },
        }),
      ).resolves.toBeNull();
    });
  });

  describe("when querying UserIngestionBinding by userId without projectId", () => {
    it("does not throw 'requires projectId' from the multitenancy middleware", async () => {
      await expect(
        prisma.userIngestionBinding.findFirst({
          where: { userId: `usr-${nanoid(8)}` },
        }),
      ).resolves.toBeNull();
    });

    it("does not throw when querying by organizationId (admin tenancy view)", async () => {
      await expect(
        prisma.userIngestionBinding.findFirst({
          where: { organizationId: `org-${nanoid(8)}` },
        }),
      ).resolves.toBeNull();
    });

    it("does not throw when querying by bindingAccessTokenHash (receiver auth path)", async () => {
      await expect(
        prisma.userIngestionBinding.findUnique({
          where: { bindingAccessTokenHash: `nope-${nanoid(16)}` },
        }),
      ).resolves.toBeNull();
    });
  });
});
