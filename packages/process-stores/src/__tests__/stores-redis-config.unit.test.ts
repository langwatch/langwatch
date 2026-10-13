/**
 * Several local stacks share one Redis server; `REDIS_DB_INDEX` keeps each stack's queue its own.
 */
import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { storesOwner } from "../config-owner.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [storesOwner], environment }).stores.redis;

describe("redis settings on the stores owner", () => {
  describe("given a stack that names its own Redis database", () => {
    it("reads REDIS_DB_INDEX, so the process opens that database and not database 0", () => {
      expect(read({ REDIS_DB_INDEX: "7" }).dbIndex).toBe("7");
    });
  });

  describe("given a deployment that names none", () => {
    it("leaves the index unset, so Redis's own default applies", () => {
      expect(read({}).dbIndex).toBeUndefined();
    });
  });
});
