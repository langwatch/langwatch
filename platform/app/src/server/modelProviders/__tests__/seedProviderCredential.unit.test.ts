import { describe, expect, it } from "vitest";
import { encrypt } from "~/utils/encryption";
import {
  credentialWriteLog,
  decideCredentialWrite,
  describeStored,
  maskSecret,
  readStoredCredential,
} from "../seedProviderCredential";

describe("readStoredCredential", () => {
  it("reads an encrypted blob", () => {
    const stored = readStoredCredential(
      encrypt(JSON.stringify({ OPENAI_API_KEY: "fake-live-abcdefgh" })),
    );

    expect(stored).toEqual({
      state: "present",
      keys: { OPENAI_API_KEY: "fake-live-abcdefgh" },
    });
  });

  it("reads a plain object from before encryption", () => {
    expect(readStoredCredential({ OPENAI_API_KEY: "fake-plain" })).toEqual({
      state: "present",
      keys: { OPENAI_API_KEY: "fake-plain" },
    });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty object", {}],
    ["an empty string", ""],
    [
      "an object of empty values",
      { OPENAI_API_KEY: "", OPENAI_BASE_URL: "  " },
    ],
  ])("treats %s as no credential", (_label, value) => {
    expect(readStoredCredential(value)).toEqual({ state: "absent" });
  });

  // A blob written under a different CREDENTIALS_SECRET. Somebody put a key
  // there; the seeder must not decide on its own that it is disposable.
  it("reports an undecryptable blob as unreadable rather than absent", () => {
    expect(readStoredCredential("not-a-valid-encrypted-blob")).toEqual({
      state: "unreadable",
    });
  });
});

const REPLACEMENT = { OPENAI_API_KEY: "fake-incoming-value" };

describe("decideCredentialWrite", () => {
  it("fills an empty credential", () => {
    expect(
      decideCredentialWrite({
        stored: { state: "absent" },
        replacement: REPLACEMENT,
        shouldForce: false,
      }),
    ).toEqual({ action: "write", reason: "no stored credential" });
  });

  it("leaves a stored credential alone", () => {
    const stored = { state: "present" as const, keys: { K: "v" } };

    expect(
      decideCredentialWrite({
        stored,
        replacement: REPLACEMENT,
        shouldForce: false,
      }),
    ).toEqual({
      action: "keep",
      reason: "a credential is already stored",
    });
  });

  // Distinct from "keep": the row cannot serve traffic, so a seeder must not
  // enable it or route to it. Collapsing the two is how an undecryptable row
  // ends up in a routing chain and fails on every request.
  it("skips an unreadable credential instead of keeping it", () => {
    expect(
      decideCredentialWrite({
        stored: { state: "unreadable" },
        replacement: REPLACEMENT,
        shouldForce: false,
      }),
    ).toEqual({
      action: "skip",
      reason: "the stored credential cannot be read",
    });
  });

  // Forcing swaps one key for another. It is never a way to empty the column,
  // and an unset environment variable is the common way to arrive here.
  it.each([
    ["null", null],
    ["an empty record", {}],
  ])("keeps a stored credential when the replacement is %s", (_label, replacement) => {
    expect(
      decideCredentialWrite({
        stored: { state: "present", keys: { K: "v" } },
        replacement,
        shouldForce: true,
      }),
    ).toEqual({ action: "keep", reason: "a credential is already stored" });
  });

  // An empty row this run cannot fill is not "left alone", it is unusable.
  // Reporting it as keep let the seeders enable a row with no credential and
  // route to it.
  it("skips a row that has no key and no replacement, so it is never enabled", () => {
    expect(
      decideCredentialWrite({
        stored: { state: "absent" },
        replacement: null,
        shouldForce: true,
      }),
    ).toEqual({ action: "skip", reason: "nothing to write" });
  });

  it.each([
    ["a stored credential", { state: "present" as const, keys: { K: "v" } }],
    ["an unreadable credential", { state: "unreadable" as const }],
  ])("replaces %s when forced", (_label, stored) => {
    expect(
      decideCredentialWrite({
        stored,
        replacement: REPLACEMENT,
        shouldForce: true,
      }),
    ).toEqual({
      action: "write",
      reason: "forced",
    });
  });
});

describe("maskSecret", () => {
  // A one or two character value is entirely head, so a head-and-ellipsis
  // mask would print the whole credential into the log line.
  it.each([
    ["a one-character value", "x"],
    ["a two-character value", "ab"],
  ])("refuses to show %s at all", (_label, value) => {
    const masked = maskSecret(value);

    expect(masked).toBe("(too short to mask)");
    expect(masked).not.toContain(value);
  });

  it("keeps enough of a long key to tell two apart", () => {
    expect(maskSecret("fake-proj-abcdefghijklmnop")).toBe("fake...mnop");
  });

  it("gives away almost nothing of a short one", () => {
    expect(maskSecret("tiny-key")).toBe("ti...");
  });

  it.each([
    ["an empty string", ""],
    ["a non-string", 42],
    ["null", null],
  ])("reports %s as empty", (_label, value) => {
    expect(maskSecret(value)).toBe("(empty)");
  });

  it("never prints a whole key", () => {
    const secret = "fake-proj-THIS-MUST-NOT-APPEAR-IN-LOGS";

    expect(maskSecret(secret)).not.toContain("MUST-NOT-APPEAR");
    expect(
      describeStored({ state: "present", keys: { K: secret } }),
    ).not.toContain("MUST-NOT-APPEAR");
  });
});

describe("credentialWriteLog", () => {
  // The line whose absence let a shared organization lose its key without
  // anybody noticing. It has to name the org, the row and both credentials.
  it("names the organization, the provider, the row and both keys", () => {
    const line = credentialWriteLog({
      tag: "seed-audio",
      organizationId: "org-shared",
      provider: "openai",
      modelProviderId: "mp-1",
      stored: {
        state: "present",
        keys: { OPENAI_API_KEY: "fake-good-abcdefgh" },
      },
      incoming: { OPENAI_API_KEY: "fake-stale-value-aaaa" },
      decision: { action: "keep", reason: "a credential is already stored" },
    });

    expect(line).toContain("KEEPING");
    expect(line).toContain("org=org-shared");
    expect(line).toContain("provider=openai");
    expect(line).toContain("row=mp-1");
    expect(line).toContain("stored OPENAI_API_KEY=fake...efgh");
    expect(line).toContain("incoming OPENAI_API_KEY=fake...aaaa");
    expect(line).toContain("a credential is already stored");
  });

  it("says SKIPPING for a credential nothing can read", () => {
    const line = credentialWriteLog({
      tag: "seed-audio",
      organizationId: "org-shared",
      provider: "openai",
      modelProviderId: "mp-3",
      stored: { state: "unreadable" },
      incoming: { OPENAI_API_KEY: "fake-new-abcdefgh" },
      decision: {
        action: "skip",
        reason: "the stored credential cannot be read",
      },
    });

    expect(line).toContain("SKIPPING");
    expect(line).toContain("stored (unreadable)");
  });

  it("says WRITING when it is going to write", () => {
    const line = credentialWriteLog({
      tag: "seed-audio",
      organizationId: "org-fresh",
      provider: "openai",
      modelProviderId: "mp-2",
      stored: { state: "absent" },
      incoming: { OPENAI_API_KEY: "fake-new-abcdefgh" },
      decision: { action: "write", reason: "no stored credential" },
    });

    expect(line).toContain("WRITING");
    expect(line).toContain("stored (none)");
  });
});
