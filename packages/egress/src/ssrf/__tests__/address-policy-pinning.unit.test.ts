import dns from "node:dns/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { classify } from "../address.ts";
import { createSsrfUrlValidator } from "../url-validator.ts";

/**
 * Spec: packages/egress/specs/egress-address-policy.feature
 */

const permissive = createSsrfUrlValidator({ blockLocal: false, allowedHosts: [] });
const strict = createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] });
const allowlisting = createSsrfUrlValidator({
  blockLocal: true,
  allowedHosts: ["intranet.example.com."],
});

function resolvesTo(records: { a?: string[]; aaaa?: string[] }) {
  vi.spyOn(dns, "resolve").mockImplementation((async (_hostname: string, recordType: string) =>
    recordType === "A" ? (records.a ?? []) : (records.aaaa ?? [])) as never);
}

afterEach(() => vi.restoreAllMocks());

describe("the egress address policy", () => {
  /** @scenario "A hostname that resolves to a cloud metadata address is refused" */
  it.each(["169.254.169.254", "100.100.100.200", "192.0.0.192"])(
    "refuses a hostname resolving to %s even when local addresses are allowed",
    async (address) => {
      resolvesTo({ a: [address] });
      await expect(permissive("https://innocent.example.com/")).rejects.toThrow(/metadata/i);
    },
  );

  describe("given an allowlisted hostname", () => {
    /** @scenario "An allowlisted hostname is still resolved, checked and pinned" */
    it("pins the address the hostname resolved to", async () => {
      resolvesTo({ a: ["10.0.0.7"] });
      await expect(allowlisting("https://intranet.example.com/x")).resolves.toMatchObject({
        type: "allowlisted",
        resolvedIp: "10.0.0.7",
      });
    });

    /** @scenario "An allowlisted hostname is still resolved, checked and pinned" */
    it("refuses it when it resolves to a cloud metadata address", async () => {
      resolvesTo({ a: ["169.254.169.254"] });
      await expect(allowlisting("https://intranet.example.com/x")).rejects.toThrow(/metadata/i);
    });
  });

  describe("given a hostname with a trailing dot", () => {
    /** @scenario "A fully-qualified hostname with a trailing dot is judged as the same name" */
    it("refuses the metadata hostname written with a trailing dot", async () => {
      const resolve = vi.spyOn(dns, "resolve");
      await expect(permissive("http://metadata.google.internal./")).rejects.toThrow(/metadata/i);
      expect(resolve).not.toHaveBeenCalled();
    });

    /** @scenario "A fully-qualified hostname with a trailing dot is judged as the same name" */
    it("matches the allowlist with or without the dot", async () => {
      resolvesTo({ a: ["10.0.0.7"] });
      await expect(allowlisting("https://intranet.example.com/x")).resolves.toMatchObject({
        type: "allowlisted",
      });
      await expect(allowlisting("https://intranet.example.com./x")).resolves.toMatchObject({
        type: "allowlisted",
      });
      await expect(strict("https://intranet.example.com./x")).rejects.toThrow(/private/i);
    });
  });

  /** @scenario "Every spelling of a metadata address classifies as metadata" */
  it.each([
    "100.100.100.200",
    "192.0.0.192",
    "::169.254.169.254",
    "::ffff:0:169.254.169.254",
    "::ffff:169.254.169.254",
  ])("classifies %s as a metadata address", (address) => {
    expect(classify(address)).toBe("metadata");
  });

  /** @scenario "Every spelling of a metadata address classifies as metadata" */
  it("classifies an IPv4-compatible private address as non-global", () => {
    expect(classify("::10.0.0.1")).toBe("special");
  });
});
