import type { Organization, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DemoOrgScope } from "../_lib/scopeGuard";
import type { SeedActionContext } from "../_lib/seedRunner";

vi.mock("../seed-bird-eye", () => ({
  runSeedBirdEye: vi.fn(),
}));

const ORG_ID = "org_acme1234";

function makeContext(execute: boolean): SeedActionContext {
  const organization = {
    id: ORG_ID,
    name: "ACME",
    slug: "acme",
  } as unknown as Organization;
  return {
    prisma: {} as unknown as PrismaClient,
    scope: new DemoOrgScope([ORG_ID]),
    organization,
    execute,
  };
}

describe("seedBirdEye SeedAction", () => {
  let runSeedBirdEyeMock: ReturnType<typeof vi.fn>;
  let seedBirdEye: any;

  beforeAll(async () => {
    const seedMod = await import("../seed-bird-eye");
    runSeedBirdEyeMock = seedMod.runSeedBirdEye as unknown as ReturnType<
      typeof vi.fn
    >;
    const actionMod = await import("../_actions/seedBirdEye");
    seedBirdEye = actionMod.seedBirdEye;
  });

  afterEach(() => {
    runSeedBirdEyeMock.mockReset();
  });

  describe("when execute is false (dry-run)", () => {
    it("returns skipped without invoking runSeedBirdEye", async () => {
      const outcome = await seedBirdEye.run(makeContext(false));
      expect(outcome.status).toBe("skipped");
      expect(runSeedBirdEyeMock).not.toHaveBeenCalled();
    });
  });

  describe("when execute is true", () => {
    it("invokes runSeedBirdEye with the scope-asserted org id and production defaults", async () => {
      runSeedBirdEyeMock.mockResolvedValue({
        organizationId: ORG_ID,
        govProjectId: "proj_gov",
        rowsInserted: 480,
        totalCostUsd: 3.27,
        sources: [
          { id: "src_1", team: "Customer Support" },
          { id: "src_2", team: "Engineering" },
          { id: "src_3", team: "Marketing" },
          { id: "src_4", team: "Org-wide" },
        ],
      });

      const outcome = await seedBirdEye.run(makeContext(true));

      expect(runSeedBirdEyeMock).toHaveBeenCalledOnce();
      expect(runSeedBirdEyeMock).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        days: 30,
        rows: 480,
        withAnomaly: true,
      });
      expect(outcome.status).toBe("succeeded");
      if (outcome.status === "succeeded") {
        expect(outcome.summary).toContain("480 rows");
        expect(outcome.summary).toContain("$3.2700");
        expect(outcome.summary).toContain("4 sources");
      }
    });

    it("propagates runSeedBirdEye throws (runner catches them)", async () => {
      runSeedBirdEyeMock.mockRejectedValue(new Error("CH inserts blew up"));
      await expect(seedBirdEye.run(makeContext(true))).rejects.toThrow(
        "CH inserts blew up",
      );
    });
  });
});
