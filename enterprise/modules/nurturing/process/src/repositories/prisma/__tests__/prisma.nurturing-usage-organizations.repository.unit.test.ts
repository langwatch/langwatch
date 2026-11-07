// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The usage sync's declared read across organizations.
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/organization-usage.feature
 */
import {
  type OperatorReadMint,
  OperatorReadsResolver,
  UndeclaredOperatorReadError,
} from "@langwatch/prisma-client";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import {
  nurturingOperatorReads,
  PrismaNurturingUsageOrganizationsRepository,
} from "../prisma.nurturing-usage-organizations.repository.ts";

const SINCE = Date.UTC(2026, 9, 7);

function repositoryOver({ declared }: { declared: boolean }) {
  const findMany = vi.fn().mockResolvedValue([
    { organizationId: "org-1", adminUserId: "admin-1" },
    { organizationId: "org-2", adminUserId: null },
  ]);
  const mint = vi.fn<OperatorReadMint>(() => prismaDouble({ nurturingOrganization: { findMany } }));
  const operatorReads = OperatorReadsResolver.over({ mint }).scopeTo({
    owner: "nurturing",
    declared: declared ? Object.values(nurturingOperatorReads) : [],
  });
  return { operatorReads, mint, findMany };
}

describe("given nurturing's declared operator read of NurturingOrganization", () => {
  describe("when the usage sync lists recently active organizations", () => {
    /** @scenario Only organizations active in the last 30 days and with an admin are read */
    it("reads on the declared handle those with an admin and a trace or a row in the window", async () => {
      const { operatorReads, mint, findMany } = repositoryOver({ declared: true });
      const organizations = PrismaNurturingUsageOrganizationsRepository.create({ operatorReads });

      const page = await organizations.findRecentlyActive({ since: SINCE, limit: 100 });

      expect(mint.mock.calls.map(([input]) => input)).toEqual([
        { owner: "nurturing", handle: nurturingOperatorReads.usageOrganizations },
      ]);
      const at = new Date(SINCE);
      expect(findMany).toHaveBeenCalledWith({
        where: {
          adminUserId: { not: null },
          OR: [{ lastTraceAt: { gte: at } }, { lastTraceAt: null, updatedAt: { gte: at } }],
        },
        orderBy: { organizationId: "asc" },
        take: 100,
        select: { organizationId: true, adminUserId: true },
      });
      expect(page).toEqual([{ organizationId: "org-1", adminUserId: "admin-1" }]);
    });

    it("pages after the given organization id", async () => {
      const { operatorReads, findMany } = repositoryOver({ declared: true });
      const organizations = PrismaNurturingUsageOrganizationsRepository.create({ operatorReads });

      await organizations.findRecentlyActive({ since: SINCE, limit: 50, afterId: "org-1" });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: { gt: "org-1" } }),
          take: 50,
        }),
      );
    });
  });

  describe("when the read is not declared", () => {
    it("refuses to build the repository", () => {
      const { operatorReads } = repositoryOver({ declared: false });

      expect(() => PrismaNurturingUsageOrganizationsRepository.create({ operatorReads })).toThrow(
        UndeclaredOperatorReadError,
      );
    });
  });
});
