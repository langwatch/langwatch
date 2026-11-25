import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaTenancyRepository } from "../prisma.tenancy.repository.ts";

describe("PrismaTenancyRepository", () => {
  describe("when listing metered organizations", () => {
    describe("given a project whose team was deleted", () => {
      /** @scenario "A project whose team was deleted does not stop the usage-warning sweep" */
      it("skips the orphan project and lists the live teams' organizations", async () => {
        const findMany = vi
          .fn()
          .mockResolvedValue([
            { team: { organizationId: "org-1" } },
            { team: null },
            { team: { organizationId: "org-2" } },
            { team: { organizationId: "org-1" } },
          ]);
        const repository = PrismaTenancyRepository.create(
          prismaDouble({ project: { findMany }, organization: {} }),
        );

        await expect(repository.findMeteredOrganizationIds()).resolves.toEqual(["org-1", "org-2"]);
      });
    });
  });
});
