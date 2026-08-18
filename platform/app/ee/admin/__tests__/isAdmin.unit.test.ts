/**
 * `adminEmailList`/`isAdmin` own the live parse of `ADMIN_EMAILS`. The
 * cutover migration (`@langwatch/authz-server`) cannot import this `ee/`
 * module and keeps its own copy, `normalizedAdminEmails` - the pinning suite
 * below asserts the two never disagree on the same input, so a change to one
 * parse that is not mirrored in the other fails here rather than surfacing as
 * a cutover report that silently drifts from who the live check actually
 * admits.
 */
import { normalizedAdminEmails } from "@langwatch/authz-server/migration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminEmailList, isAdmin } from "../isAdmin";

describe("adminEmailList", () => {
  const original = process.env.ADMIN_EMAILS;

  afterEach(() => {
    process.env.ADMIN_EMAILS = original;
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
    process.env.ADMIN_EMAILS = original;
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

/**
 * The pinning suite (delivery-plan PR 3, item 7): `adminEmailList` (this
 * platform module, live authority for `isAdmin`) and `normalizedAdminEmails`
 * (the package's own copy, used only by the cutover migration's report) are
 * two independent implementations of the same parse. Nothing makes the
 * compiler catch a drift between them, so this fixture does instead - same
 * input, same SET of admitted addresses, on cases that actually exercise the
 * parse: spacing, case, and blanks.
 *
 * Compared as sets rather than arrays: `normalizedAdminEmails` also dedupes
 * (it feeds an import count, where a repeated address must count once), which
 * `adminEmailList` has no reason to do for a plain membership check. That is
 * a deliberate difference in what each caller needs from the list, not a
 * drift in what counts as an admitted ADDRESS - which is exactly the
 * invariant this suite pins.
 */
describe("adminEmailList and normalizedAdminEmails (packages/authz-server)", () => {
  const original = process.env.ADMIN_EMAILS;

  afterEach(() => {
    process.env.ADMIN_EMAILS = original;
  });

  it.each([
    [" Root@Langwatch.ai , ops@langwatch.ai,,  second@Example.com "],
    [""],
    ["only@one.example"],
    [" , , "],
    ["dup@example.com,DUP@Example.com"],
  ])("admits the same addresses parsing %j", (raw) => {
    process.env.ADMIN_EMAILS = raw;
    // `adminEmailList` reads the env var and splits it itself;
    // `normalizedAdminEmails` takes an already-split array (its caller,
    // `runtime.ts`, does the splitting) - so the fixture is fed to each the
    // way its own caller feeds it.
    expect(new Set(adminEmailList())).toEqual(
      new Set(normalizedAdminEmails(raw.split(","))),
    );
  });
});
