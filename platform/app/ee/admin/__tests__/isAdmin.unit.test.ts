/** `adminEmailList`/`isAdmin` own the live parse of `ADMIN_EMAILS`. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminEmailList, isAdmin } from "../isAdmin";

describe("adminEmailList", () => {
  const original = process.env.ADMIN_EMAILS;

  afterEach(() => {
    // Assigning `undefined` back would store the STRING "undefined";
    // restoring an unset variable means deleting the key.
    if (original === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = original;
  });

  describe("given no ADMIN_EMAILS", () => {
    it("returns an empty list", () => {
      delete process.env.ADMIN_EMAILS;
      expect(adminEmailList()).toEqual([]);
    });
  });

  describe("given a mixed-case, spaced, blank-padded list", () => {
    it("trims, lowercases and drops blanks", () => {
      process.env.ADMIN_EMAILS =
        " Root@Langwatch.ai , ops@langwatch.ai,,  second@Example.com ";
      expect(adminEmailList()).toEqual([
        "root@langwatch.ai",
        "ops@langwatch.ai",
        "second@example.com",
      ]);
    });
  });
});

describe("isAdmin", () => {
  const original = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    process.env.ADMIN_EMAILS = "root@langwatch.ai, ops@langwatch.ai";
  });

  afterEach(() => {
    // Assigning `undefined` back would store the STRING "undefined";
    // restoring an unset variable means deleting the key.
    if (original === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = original;
  });

  describe("given a user whose email is on the list, in a different case", () => {
    it("answers true", () => {
      expect(isAdmin({ email: "Root@Langwatch.ai" })).toBe(true);
    });
  });

  describe("given a user whose email is not on the list", () => {
    it("answers false", () => {
      expect(isAdmin({ email: "someone-else@langwatch.ai" })).toBe(false);
    });
  });

  describe("given a user with no email", () => {
    it("answers false without reading the list", () => {
      expect(isAdmin({ email: null })).toBe(false);
    });
  });
});
