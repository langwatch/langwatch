import type Redis from "ioredis";
import { describe, expect, it } from "vitest";
import { InvalidTenantIdError } from "../errors";
import { redisBlobSpool } from "./redisBlobSpool";

/** Never called: validation must reject before any Redis command is issued. */
const untouchedRedis = new Proxy(
  {},
  {
    get: () => () =>
      Promise.reject(
        new Error(
          "redisBlobSpool touched Redis before validating the tenant id",
        ),
      ),
  },
) as unknown as Redis;

describe("redisBlobSpool tenant id validation", () => {
  describe("given a spool put with a tenant id containing the key separator", () => {
    /** @scenario A tenant id containing the key separator is refused */
    it("refuses it rather than constructing a colliding key", async () => {
      const spool = redisBlobSpool(untouchedRedis);
      await expect(spool.put("other-tenant/nested", "body")).rejects.toThrow(
        InvalidTenantIdError,
      );
    });

    it("refuses a tenant id containing a hash-tag brace", async () => {
      const spool = redisBlobSpool(untouchedRedis);
      await expect(spool.put("tenant{1}", "body")).rejects.toThrow(
        InvalidTenantIdError,
      );
    });

    it("refuses an empty tenant id", async () => {
      const spool = redisBlobSpool(untouchedRedis);
      await expect(spool.put("", "body")).rejects.toThrow(InvalidTenantIdError);
    });
  });
});
