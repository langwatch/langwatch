/**
 * The wire boundary: a secret's value goes out and never comes back.
 *
 * A type cannot be asserted at runtime, so what is checked is the CONTRACT
 * SCHEMA the map's list output is declared as. `secretSchema` is `.strict()`,
 * which is the property that makes the guarantee mechanical rather than
 * conventional: a projection that added a value to a list row would fail its own
 * parse before it ever reached a browser.
 *
 * The map itself is hand-written until the router can emit it, so this is where
 * "the shape did not quietly widen" is stated.
 *
 * Spec: specs/secrets/secrets-manager.feature
 */

import { secretSchema } from "@langwatch/secret-contract";
import { describe, expect, it } from "vitest";

const ROW = {
  id: "secret-1",
  projectId: "proj-1",
  name: "OPENAI_API_KEY",
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: { name: "Jane" },
  updatedBy: { name: "Jane" },
};

describe("given the shape every read of this feature answers", () => {
  describe("when a row carries a value", () => {
    /** @scenario A secret's value is never readable after it is stored */
    it("is refused by the schema rather than passed through", () => {
      expect(secretSchema.safeParse({ ...ROW, value: "sk-real" }).success).toBe(false);
      expect(secretSchema.safeParse({ ...ROW, encryptedValue: "…" }).success).toBe(false);
    });
  });

  describe("when a row carries only metadata", () => {
    /** @scenario View secrets list */
    it("parses, so the table has everything it renders and nothing more", () => {
      const parsed = secretSchema.safeParse(ROW);
      expect(parsed.success).toBe(true);
      expect(Object.keys(parsed.data!).sort()).toEqual([
        "createdAt",
        "createdBy",
        "id",
        "name",
        "projectId",
        "updatedAt",
        "updatedBy",
      ]);
    });
  });
});
