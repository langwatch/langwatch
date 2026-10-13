import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { credentialKeyFingerprint } from "../credential-key-fingerprint.ts";

/** @see specs/self-hosting/credentials-secret-rotation.feature */

describe("credentialKeyFingerprint", () => {
  const hex = randomBytes(32).toString("hex");

  /** @scenario "A serving process records a fingerprint of each credential key it accepts, never the key" */
  it("answers a short hash that names the key without holding it", () => {
    const fingerprint = credentialKeyFingerprint({ hex });

    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(hex).not.toContain(fingerprint);
    expect(credentialKeyFingerprint({ hex: ` ${hex.toUpperCase()}\n` })).toBe(fingerprint);
    expect(credentialKeyFingerprint({ hex: randomBytes(32).toString("hex") })).not.toBe(
      fingerprint,
    );
    expect(credentialKeyFingerprint({ hex: "session-one" })).not.toBe(
      credentialKeyFingerprint({ hex: "session-two" }),
    );
  });
});
