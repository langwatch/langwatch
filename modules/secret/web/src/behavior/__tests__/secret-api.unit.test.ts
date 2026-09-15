/**
 * The wire contract ensures a secret's value never leaks to clients. The `.strict()`
 * secretSchema enforces this mechanically—any projection that added a value would fail
 * parsing before reaching a browser. Spec: specs/secrets/secrets-manager.feature
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
