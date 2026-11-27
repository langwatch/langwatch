import { privateRouteNameOf } from "@langwatch/process-stores";
import { describe, expect, it, vi } from "vitest";

import { withChainedSecrets } from "../lwql-default-credentials.rules.ts";
import {
  parsePrivateReaderPasswords,
  privateReaderLookupOf,
  privateReaderNameOf,
  privateReaderOf,
  resolvePrivateReader,
} from "../lwql-private-reader.rules.ts";

/** The rules' parse with the private families' own name split, as every caller passes. */
const readerPasswordsOf = (source: Record<string, string | undefined>) =>
  parsePrivateReaderPasswords({ source, nameOf: privateRouteNameOf });

const PEPPER = "fake-test-pepper";
const OWN = "fake-own-reader-password-0123456789";

describe("parsePrivateReaderPasswords", () => {
  /** @scenario "A private ClickHouse's reader signs in with the instance's own password where one is set" */
  it("keys each password by the organisation after the last double underscore", () => {
    const parsed = readerPasswordsOf({
      "LWQL_PRIVATE_READER_PASSWORD__acme__org-acme": OWN,
      "LWQL_PRIVATE_READER_PASSWORD__org-bare": "fake-bare-reader-password-0123456789",
      LWQL_CLICKHOUSE_PASSWORD: "fake-unrelated",
      "LWQL_PRIVATE_READER_PASSWORD__unset__org-unset": undefined,
    });

    expect([...parsed.passwords]).toEqual([
      ["org-acme", OWN],
      ["org-bare", "fake-bare-reader-password-0123456789"],
    ]);
    expect(parsed.refused.size).toBe(0);
  });

  /** @scenario "A blank or doubled private reader password is refused, never derived" */
  it("refuses a blank value, naming its variable", () => {
    const parsed = readerPasswordsOf({
      "LWQL_PRIVATE_READER_PASSWORD__acme__org-acme": "  \n",
      "LWQL_PRIVATE_READER_PASSWORD__other__org-empty": "",
    });

    expect(parsed.passwords.size).toBe(0);
    expect([...parsed.refused]).toEqual([
      ["org-acme", "LWQL_PRIVATE_READER_PASSWORD__acme__org-acme"],
      ["org-empty", "LWQL_PRIVATE_READER_PASSWORD__other__org-empty"],
    ]);
  });

  /** @scenario "A blank or doubled private reader password is refused, never derived" */
  it("refuses an organisation two variables name, keeping neither password", () => {
    const parsed = readerPasswordsOf({
      "LWQL_PRIVATE_READER_PASSWORD__one__org-acme": OWN,
      "LWQL_PRIVATE_READER_PASSWORD__two__org-acme": "fake-second-reader-password-01234567",
    });

    expect(parsed.passwords.has("org-acme")).toBe(false);
    expect(parsed.refused.get("org-acme")).toBe("LWQL_PRIVATE_READER_PASSWORD__two__org-acme");
  });
});

describe("parsePrivateReaderPasswords, given a short or shared password", () => {
  /** @scenario "A short or shared private reader password is refused, never derived" */
  it("refuses a password shorter than 32 characters once trimmed, and keeps one of 32", () => {
    const parsed = readerPasswordsOf({
      "LWQL_PRIVATE_READER_PASSWORD__short__org-short": "x".repeat(31),
      "LWQL_PRIVATE_READER_PASSWORD__padded__org-padded": ` ${"y".repeat(31)}\n`,
      "LWQL_PRIVATE_READER_PASSWORD__exact__org-exact": "z".repeat(32),
    });

    expect([...parsed.passwords]).toEqual([["org-exact", "z".repeat(32)]]);
    expect([...parsed.refused]).toEqual([
      ["org-short", "LWQL_PRIVATE_READER_PASSWORD__short__org-short"],
      ["org-padded", "LWQL_PRIVATE_READER_PASSWORD__padded__org-padded"],
    ]);
  });

  /** @scenario "A short or shared private reader password is refused, never derived" */
  it("refuses every organisation sharing one value, keeping the others", () => {
    const parsed = readerPasswordsOf({
      "LWQL_PRIVATE_READER_PASSWORD__a__org-a": OWN,
      "LWQL_PRIVATE_READER_PASSWORD__b__org-b": OWN,
      "LWQL_PRIVATE_READER_PASSWORD__c__org-c": "fake-third-reader-password-0123456789",
    });

    expect([...parsed.passwords.keys()]).toEqual(["org-c"]);
    expect([...parsed.refused]).toEqual([
      ["org-a", "LWQL_PRIVATE_READER_PASSWORD__a__org-a"],
      ["org-b", "LWQL_PRIVATE_READER_PASSWORD__b__org-b"],
    ]);
    expect(
      resolvePrivateReader({ organizationId: "org-a", passwords: parsed, keyPepper: PEPPER }),
    ).toEqual({ kind: "refused", variable: "LWQL_PRIVATE_READER_PASSWORD__a__org-a" });
  });
});

describe("parsePrivateReaderPasswords, given a variable naming no organisation", () => {
  /** @scenario "A private reader password variable naming no organization is ignored" */
  it.each([
    ["no id", "LWQL_PRIVATE_READER_PASSWORD__"],
    ["an empty id after the label", "LWQL_PRIVATE_READER_PASSWORD__acme__"],
    ["an id starting with an underscore", "LWQL_PRIVATE_READER_PASSWORD___org-acme"],
  ])("ignores a variable with %s", (_kind, variable) => {
    const parsed = readerPasswordsOf({ [variable]: OWN });

    expect(parsed.passwords.size).toBe(0);
    expect(parsed.refused.size).toBe(0);
  });
});

describe("resolvePrivateReader", () => {
  const passwords = readerPasswordsOf({
    "LWQL_PRIVATE_READER_PASSWORD__acme__org-acme": OWN,
    "LWQL_PRIVATE_READER_PASSWORD__blank__org-blank": " ",
  });

  /** @scenario "A private ClickHouse's reader signs in with the instance's own password where one is set" */
  it("uses the organisation's own password over the key pepper's, under the same login name", () => {
    const resolved = resolvePrivateReader({
      organizationId: "org-acme",
      passwords,
      keyPepper: PEPPER,
    });
    const derived = privateReaderOf({ organizationId: "org-acme", keyPepper: PEPPER });

    expect(resolved).toEqual({
      kind: "own",
      reader: { ...privateReaderNameOf({ organizationId: "org-acme" }), password: OWN },
    });
    expect(resolved.kind === "own" && resolved.reader.username).toBe(derived.username);
    expect(resolved.kind === "own" && resolved.reader.password).not.toBe(derived.password);
  });

  /** @scenario "A private ClickHouse's reader signs in with the instance's own password where one is set" */
  it("uses the organisation's own password with no key pepper at all", () => {
    const resolved = resolvePrivateReader({
      organizationId: "org-acme",
      passwords,
      keyPepper: undefined,
    });

    expect(resolved.kind).toBe("own");
    expect(resolved.kind === "own" && resolved.reader.password).toBe(OWN);
  });

  /** @scenario "Without its own password a private reader falls back to the key pepper and warns" */
  it("derives the same reader as before where the organisation has no password of its own", () => {
    const resolved = resolvePrivateReader({
      organizationId: "org-other",
      passwords,
      keyPepper: PEPPER,
    });

    expect(resolved).toEqual({
      kind: "derived",
      reader: privateReaderOf({ organizationId: "org-other", keyPepper: PEPPER }),
    });
  });

  /** @scenario "A blank or doubled private reader password is refused, never derived" */
  it("refuses a blank variable even with a key pepper set", () => {
    expect(
      resolvePrivateReader({ organizationId: "org-blank", passwords, keyPepper: PEPPER }),
    ).toEqual({ kind: "refused", variable: "LWQL_PRIVATE_READER_PASSWORD__blank__org-blank" });
  });

  /** @scenario "A private route with no key pepper to derive a reader from is refused" */
  it("has no reader with neither the organisation's own password nor a key pepper", () => {
    expect(
      resolvePrivateReader({ organizationId: "org-other", passwords, keyPepper: undefined }),
    ).toEqual({ kind: "absent" });
  });
});

describe("privateReaderLookupOf", () => {
  /** @scenario "A private route with no key pepper to derive a reader from is refused" */
  it("answers null for every organisation with no key pepper and no reader password variable", () => {
    const onFallback = vi.fn();
    const lookup = privateReaderLookupOf({
      passwords: readerPasswordsOf({}),
      keyPepper: undefined,
      onFallback,
    });

    expect(lookup({ organizationId: "org-acme" })).toBeNull();
    expect(onFallback).toHaveBeenCalledWith({
      organizationId: "org-acme",
      fallback: { kind: "absent" },
    });
  });

  /** @scenario "A private ClickHouse's reader signs in with the instance's own password where one is set" */
  it("answers the own password with no key pepper, and null for an organisation without one", () => {
    const onFallback = vi.fn();
    const lookup = privateReaderLookupOf({
      passwords: readerPasswordsOf({
        "LWQL_PRIVATE_READER_PASSWORD__acme__org-acme": OWN,
      }),
      keyPepper: undefined,
      onFallback,
    });

    expect(lookup({ organizationId: "org-acme" })?.password).toBe(OWN);
    expect(onFallback).not.toHaveBeenCalled();
    expect(lookup({ organizationId: "org-other" })).toBeNull();
    expect(onFallback).toHaveBeenCalledWith({
      organizationId: "org-other",
      fallback: { kind: "absent" },
    });
  });

  /** @scenario "A blank or doubled private reader password is refused, never derived" */
  it("answers null for a refused variable though a key pepper is set, telling which variable", () => {
    const onFallback = vi.fn();
    const lookup = privateReaderLookupOf({
      passwords: readerPasswordsOf({
        "LWQL_PRIVATE_READER_PASSWORD__acme__org-acme": " ",
      }),
      keyPepper: PEPPER,
      onFallback,
    });

    expect(lookup({ organizationId: "org-acme" })).toBeNull();
    expect(onFallback).toHaveBeenCalledWith({
      organizationId: "org-acme",
      fallback: { kind: "refused", variable: "LWQL_PRIVATE_READER_PASSWORD__acme__org-acme" },
    });
  });

  /** @scenario "Without its own password a private reader falls back to the key pepper and warns" */
  it("tells each derived fallback once per organisation", () => {
    const onFallback = vi.fn();
    const lookup = privateReaderLookupOf({
      passwords: readerPasswordsOf({}),
      keyPepper: PEPPER,
      onFallback,
    });

    lookup({ organizationId: "org-acme" });
    lookup({ organizationId: "org-acme" });

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org-acme",
      fallback: { kind: "derived" },
    });
  });
});

describe("withChainedSecrets, given the reader password family", () => {
  /** @scenario "The upgrade and render tasks read private reader passwords through the secrets chain" */
  it("lays each name the chain answers under the prefix over the environment", async () => {
    const chained = "fake-chained-reader-password-0123456789";
    const lookupFamily = async (prefix: string) => new Map([[`${prefix}acme__org-acme`, chained]]);

    const resolved = await withChainedSecrets({
      environment: {
        "LWQL_PRIVATE_READER_PASSWORD__acme__org-acme": "fake-stale-reader-password-0123456789",
        "LWQL_PRIVATE_READER_PASSWORD__blank__org-blank": "",
      },
      lookup: undefined,
      lookupFamily,
    });

    expect(resolved["LWQL_PRIVATE_READER_PASSWORD__acme__org-acme"]).toBe(chained);
    expect(readerPasswordsOf(resolved).refused.has("org-blank")).toBe(true);
  });

  /** @scenario "The upgrade and render tasks read private reader passwords through the secrets chain" */
  it("leaves the environment as it is with no family lookup", async () => {
    const environment = { "LWQL_PRIVATE_READER_PASSWORD__acme__org-acme": OWN };

    expect(await withChainedSecrets({ environment, lookup: undefined })).toEqual(environment);
  });
});
