/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { acceptingInfiniteQueryKeys } from "../infinite-input.ts";

const pageInput = z
  .object({ projectId: z.string(), cursor: z.string().nullish(), limit: z.number() })
  .strict();

describe("acceptingInfiniteQueryKeys", () => {
  describe("given a strict page input", () => {
    /** @scenario "A strict page input accepts the direction an infinite query adds" */
    it("drops the direction an infinite query adds", () => {
      const parsed = acceptingInfiniteQueryKeys(pageInput).safeParse({
        projectId: "p1",
        cursor: null,
        limit: 20,
        direction: "forward",
      });

      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ projectId: "p1", cursor: null, limit: 20 });
    });

    it("still refuses any other unknown key", () => {
      const parsed = acceptingInfiniteQueryKeys(pageInput).safeParse({
        projectId: "p1",
        limit: 20,
        extra: true,
      });

      expect(parsed.success).toBe(false);
    });
  });

  describe("given a schema with its own direction field", () => {
    it("keeps a direction that is not an infinite query direction", () => {
      const sorted = z.object({ direction: z.enum(["asc", "desc"]) }).strict();

      const parsed = acceptingInfiniteQueryKeys(sorted).safeParse({ direction: "desc" });

      expect(parsed.data).toEqual({ direction: "desc" });
    });
  });
});
