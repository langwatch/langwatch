import { instantiateRepositories } from "@langwatch/process";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it, vi } from "vitest";

import { authzRepositories } from "../../authz-repositories.registry.ts";

function liveRedis() {
  const get = vi.fn(async (_key: unknown) => "4");
  const incr = vi.fn(async (_key: unknown) => 5);
  return { redis: redisDouble({ get, incr }), get, incr };
}

describe("authz's live repository tier", () => {
  describe("given a process that opened Postgres and Redis", () => {
    it("keeps the permission-cache epoch under its unchanged Redis key", async () => {
      const { redis, get, incr } = liveRedis();
      const { epoch } = instantiateRepositories(authzRepositories, {
        tier: "live",
        members: { prisma: prismaDouble(), redis },
      });

      await expect(epoch.findEpoch({ organizationId: "org_acme" })).resolves.toBe(4);
      await epoch.bump({ organizationId: "org_acme" });

      expect(get).toHaveBeenCalledWith("authz:epoch:org_acme");
      expect(incr).toHaveBeenCalledWith("authz:epoch:org_acme");
    });

    it("keeps each user's session version under its unchanged Redis key", async () => {
      const { redis, get, incr } = liveRedis();
      const { sessionVersions } = instantiateRepositories(authzRepositories, {
        tier: "live",
        members: { prisma: prismaDouble(), redis },
      });

      await expect(sessionVersions.getVersion({ userId: "user_sam" })).resolves.toBe(4);
      await sessionVersions.bump({ userIds: ["user_sam"] });

      expect(get).toHaveBeenCalledWith("authz:session-version:user_sam");
      expect(incr).toHaveBeenCalledWith("authz:session-version:user_sam");
    });
  });

  describe("given a process that opened no Redis", () => {
    it("refuses the live tier naming the missing Redis", () => {
      expect(() =>
        instantiateRepositories(authzRepositories, {
          tier: "live",
          members: { prisma: prismaDouble() },
        }),
      ).toThrow(/"redis"/);
    });
  });
});
