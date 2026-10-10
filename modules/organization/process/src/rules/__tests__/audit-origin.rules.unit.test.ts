import { describe, expect, it } from "vitest";

import { auditOriginOf } from "../audit-origin.rules.ts";

describe("auditOriginOf()", () => {
  const row = { metadata: null, action: "project.rename", args: {}, userId: "user-1" };

  describe("given a row the door stamped", () => {
    it("reads the stamped channel over every other hint", () => {
      expect(
        auditOriginOf({
          ...row,
          action: "management.projects.create",
          metadata: { channel: "app" },
        }).channel,
      ).toBe("app");
      expect(auditOriginOf({ ...row, metadata: { channel: "api" } }).channel).toBe("api");
    });

    it("reads a person's key from the metadata beside them", () => {
      expect(auditOriginOf({ ...row, metadata: { channel: "api", apiKeyId: "key-7" } })).toEqual({
        channel: "api",
        apiKeyId: "key-7",
      });
    });
  });

  describe("given a row written before the stamp", () => {
    it.each([
      ["a management action", { action: "management.projects.create" }],
      ["a service key's user id", { userId: "apikey:key-9" }],
      ["REST args carrying a scope", { args: { scope: { tier: "project", id: "p" } } }],
    ])("reads %s as the API", (_hint, hint) => {
      expect(auditOriginOf({ ...row, ...hint }).channel).toBe("api");
    });

    it("reads a service key's id from its user id", () => {
      expect(auditOriginOf({ ...row, userId: "apikey:key-9" }).apiKeyId).toBe("key-9");
    });

    it("reads any other row with a person as the app, with no key", () => {
      expect(auditOriginOf(row)).toEqual({ channel: "app", apiKeyId: null });
    });

    it("reads a row with nobody as no channel", () => {
      expect(auditOriginOf({ ...row, userId: null }).channel).toBeNull();
    });
  });
});
