import { describe, expect, it, vi } from "vitest";

import {
  parsePrivateReaderPasswords,
  privateReaderLookupOf,
  privateReaderNameOf,
  privateReaderOf,
  resolvePrivateReader,
} from "../lwql-private-reader.rules.ts";

const PEPPER = "fake-test-pepper";
const OWN = "fake-own-reader-password";

describe("parsePrivateReaderPasswords", () => {
  /** @scenario "A private ClickHouse's reader signs in with the instance's own password where one is set" */
  it("keys each password by the organisation after the last double underscore", () => {
    const parsed = parsePrivateReaderPasswords({
      "LWQL_PRIVATE_READER_PASSWORD__acme__org-acme": OWN,
      "LWQL_PRIVATE_READER_PASSWORD__org-bare": "fake-bare-password",
      LWQL_CLICKHOUSE_PASSWORD: "fake-unrelated",
      "LWQL_PRIVATE_READER_PASSWORD__unset__org-unset": undefined,
    });

    expect([...parsed.passwords]).toEqual([
      ["org-acme", OWN],
      ["org-bare", "fake-bare-password"],
    ]);
    expect(parsed.refused.size).toBe(0);
  });

  /** @scenario "A blank or doubled private reader password is refused, never derived" */
  it("refuses a blank value, naming its variable", () => {
    const parsed = parsePrivateReaderPasswords({
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
    const parsed = parsePrivateReaderPasswords({
      "LWQL_PRIVATE_READER_PASSWORD__one__org-acme": OWN,
      "LWQL_PRIVATE_READER_PASSWORD__two__org-acme": "fake-second-password",
    });

    expect(parsed.passwords.has("org-acme")).toBe(false);
    expect(parsed.refused.get("org-acme")).toBe("LWQL_PRIVATE_READER_PASSWORD__two__org-acme");
  });
});

describe("resolvePrivateReader", () => {
  const passwords = parsePrivateReaderPasswords({
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
      passwords: parsePrivateReaderPasswords({}),
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
      passwords: parsePrivateReaderPasswords({
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
      passwords: parsePrivateReaderPasswords({
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
      passwords: parsePrivateReaderPasswords({}),
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
