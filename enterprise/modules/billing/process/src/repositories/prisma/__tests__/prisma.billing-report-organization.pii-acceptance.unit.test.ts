// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The PII redaction meter's one extra organization read: when an organization admin accepted the
 * model's price, the moment billing counts PII redaction spend from (ADR-201 decision 15).
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaBillingReportOrganizationRepository } from "../prisma.billing-report-organization.repository.ts";

/** A Postgres holding one organization row, recording what the repository asked it. */
function repositoryOver(row: { piiRedactionModelAcceptedAt: Date | null } | null) {
  const asked: unknown[] = [];
  const prisma = prismaDouble({
    organization: {
      findUnique: async (args) => {
        asked.push(args);
        return row;
      },
    },
  });

  return { asked, repository: PrismaBillingReportOrganizationRepository.create(prisma) };
}

describe("PrismaBillingReportOrganizationRepository, the PII redaction model's acceptance", () => {
  describe("when an organization admin accepted the price", () => {
    /** @scenario "An organization that accepted the price is billed only from the moment it accepted" */
    it("answers the moment in epoch milliseconds, reading that one column", async () => {
      const { asked, repository } = repositoryOver({
        piiRedactionModelAcceptedAt: new Date("2026-02-10T09:30:00.000Z"),
      });

      await expect(
        repository.findPiiRedactionModelAcceptedAtMs({ organizationId: "org_1" }),
      ).resolves.toBe(Date.parse("2026-02-10T09:30:00.000Z"));
      expect(asked).toEqual([
        { where: { id: "org_1" }, select: { piiRedactionModelAcceptedAt: true } },
      ]);
    });
  });

  describe("when no admin accepted it, or the organization is unknown", () => {
    /** @scenario "An organization that never accepted the price reports no PII redaction spend" */
    it.each([
      { state: "never accepted", row: { piiRedactionModelAcceptedAt: null } },
      { state: "unknown", row: null },
    ])("answers null for an organization $state", async ({ row }) => {
      const { repository } = repositoryOver(row);

      await expect(
        repository.findPiiRedactionModelAcceptedAtMs({ organizationId: "org_1" }),
      ).resolves.toBeNull();
    });
  });
});
