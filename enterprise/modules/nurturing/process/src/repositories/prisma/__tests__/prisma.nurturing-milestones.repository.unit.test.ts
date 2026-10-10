// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: enterprise/modules/nurturing/specs/nurturing.feature
 */
import { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";

import { PrismaNurturingMilestonesRepository } from "../prisma.nurturing-milestones.repository.ts";

function repositoryWithUpsert() {
  const prisma = new PrismaClient({ accelerateUrl: "prisma://localhost/test" });
  const upsert = vi.spyOn(prisma.nurturingOrganization, "upsert");
  return { repository: new PrismaNurturingMilestonesRepository(prisma), upsert };
}

const row = {
  organizationId: "org_1",
  adminUserId: "user_1",
  seeded: false,
  evaluationCount: 0,
  simulationRunCount: 0,
  updatedAt: new Date(),
};

const input = { organizationId: "org_1", adminUserId: "user_1", seeded: false };

describe("given two events recording one organization at once", () => {
  describe("when the create loses the race on the primary key", () => {
    it("retries as an update and succeeds", async () => {
      const { repository, upsert } = repositoryWithUpsert();
      upsert
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          }),
        )
        .mockResolvedValueOnce(row);

      await expect(repository.recordOrganization(input)).resolves.toBeUndefined();
      expect(upsert).toHaveBeenCalledTimes(2);
    });

    it("rethrows any other failure", async () => {
      const { repository, upsert } = repositoryWithUpsert();
      upsert.mockRejectedValue(new Error("connection lost"));

      await expect(repository.recordOrganization(input)).rejects.toThrow("connection lost");
    });
  });
});
