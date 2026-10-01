import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  isLicenseTokenShape,
  LICENSE_TOKEN_PREFIX,
  registryHashForToken,
} from "../license-token.ts";

const token = `${LICENSE_TOKEN_PREFIX}${"a1".repeat(32)}`;

describe("the registry hash of a license token", () => {
  it("is 64 hex characters that are not the token body", async () => {
    const hash = await registryHashForToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token.slice(LICENSE_TOKEN_PREFIX.length));
    expect(token).not.toContain(hash);
  });

  it("is the same every time, so a key can be looked up by it", async () => {
    expect(await registryHashForToken(token)).toBe(await registryHashForToken(token));
  });

  it("is the SHA-256 of the whole token, prefix included", async () => {
    expect(await registryHashForToken(token)).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
  });
});

describe("the shape of a presented license token", () => {
  it("accepts the prefix and 64 lowercase hex characters", () => {
    expect(isLicenseTokenShape(token)).toBe(true);
  });

  it.each([
    ["a virtual key", "vk-lw-01HZX9N0000000000000000000"],
    ["a body that is too short", `lwl_${"a".repeat(63)}`],
    ["a body that is too long", `lwl_${"a".repeat(65)}`],
    ["uppercase hex", `lwl_${"A".repeat(64)}`],
    ["characters outside hex", `lwl_${"g".repeat(64)}`],
  ])("refuses %s", (_label, value) => {
    expect(isLicenseTokenShape(value)).toBe(false);
  });
});
