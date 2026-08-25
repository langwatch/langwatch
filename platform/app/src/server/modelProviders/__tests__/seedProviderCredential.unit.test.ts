import { describe, expect, it } from "vitest";
import { encrypt } from "~/utils/encryption";
import {
  credentialWriteLog,
  decideCredentialWrite,
  describeStored,
  maskSecret,
  readStoredCredential,
  rowIsUsable,
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
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "an empty object", value: {} },
    { label: "an empty string", value: "" },
    {
      label: "an object of empty values",
      value: { OPENAI_API_KEY: "", OPENAI_BASE_URL: "  " },
    },
  ])("treats $label as no credential", ({ value }) => {
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

  // A record whose values are blank is not a credential. Treating it as one
  // let a forced run replace a working key with whitespace, which empties the
  // column by another name.
  it.each([
    { label: "an empty string", replacement: { OPENAI_API_KEY: "" } },
    { label: "whitespace", replacement: { OPENAI_API_KEY: "   " } },
    { label: "a null value", replacement: { OPENAI_API_KEY: null } },
  ])(
    "keeps a stored credential when the replacement is $label, even forced",
    ({ replacement }) => {
      expect(
        decideCredentialWrite({
          stored: { state: "present", keys: { OPENAI_API_KEY: "fake-working" } },
          replacement,
          shouldForce: true,
        }),
      ).toEqual({ action: "keep", reason: "a credential is already stored" });
    },
  );

  // Forcing swaps one key for another. It is never a way to empty the column,
  // and an unset environment variable is the common way to arrive here.
  it.each([
    { label: "null", replacement: null },
    { label: "an empty record", replacement: {} },
  ])("keeps a stored credential when the replacement is $label", ({ replacement }) => {
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
    {
      label: "a stored credential",
      stored: { state: "present" as const, keys: { K: "v" } },
    },
    {
      label: "an unreadable credential",
      stored: { state: "unreadable" as const },
    },
  ])("replaces $label when forced", ({ stored }) => {
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

describe("rowIsUsable", () => {
  // This is what decides whether a seeder enables a provider and puts it in
  // the routing chain. An unset environment variable must not drop a provider
  // the organization already has a working credential for.
  it("keeps a provider whose stored credential is readable and unreplaced", () => {
    const decision = decideCredentialWrite({
      stored: { state: "present", keys: { OPENAI_API_KEY: "fake-working" } },
      replacement: null,
      shouldForce: false,
    });

    expect(decision).toEqual({
      action: "keep",
      reason: "a credential is already stored",
    });
    expect(rowIsUsable(decision)).toBe(true);
  });

  it.each([
    {
      label: "nothing stored and nothing to write",
      stored: { state: "absent" as const },
    },
    {
      label: "a credential nothing can read",
      stored: { state: "unreadable" as const },
    },
  ])("drops a provider with $label", ({ stored }) => {
    const decision = decideCredentialWrite({
      stored,
      replacement: null,
      shouldForce: false,
    });

    expect(rowIsUsable(decision)).toBe(false);
  });

  it("keeps a provider that this run just filled", () => {
    const decision = decideCredentialWrite({
      stored: { state: "absent" },
      replacement: { OPENAI_API_KEY: "fake-new" },
      shouldForce: false,
    });

    expect(rowIsUsable(decision)).toBe(true);
  });
});

describe("maskSecret", () => {
  // A one or two character value is entirely head, so a head-and-ellipsis
  // mask would print the whole credential into the log line.
  it.each([
    { label: "a one-character value", value: "x" },
    { label: "a two-character value", value: "ab" },
  ])("refuses to show $label at all", ({ value }) => {
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
    { label: "an empty string", value: "" },
    { label: "a non-string", value: 42 },
    { label: "null", value: null },
  ])("reports $label as empty", ({ value }) => {
    expect(maskSecret(value)).toBe("(empty)");
  });

  it("never prints a whole key", () => {
    const secret = "fake-proj-THIS-MUST-NOT-APPEAR-IN-LOGS";

    expect(maskSecret(secret)).not.toContain("MUST-NOT-APPEAR");
    expect(describeStored({ state: "present", keys: { K: secret } })).not.toContain(
      "MUST-NOT-APPEAR",
    );
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
