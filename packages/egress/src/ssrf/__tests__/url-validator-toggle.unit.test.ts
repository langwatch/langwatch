import dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSsrfUrlValidator } from "../url-validator";

/**
 * Spec: specs/security/ssrf-blocking.feature
 */

function resolvesTo(records: { a?: string[]; aaaa?: string[] }) {
  vi.spyOn(dns, "resolve").mockImplementation((async (_hostname: string, recordType: string) =>
    recordType === "A" ? (records.a ?? []) : (records.aaaa ?? [])) as never);
}

afterEach(() => vi.restoreAllMocks());

describe("SSRF blocking via BLOCK_LOCAL_HTTP_CALLS toggle (TS half)", () => {
  describe("given BLOCK_LOCAL_HTTP_CALLS is unset", () => {
    const validate = createSsrfUrlValidator({ blockLocal: false, allowedHosts: [] });

    /** @scenario <impl> allows private IP literals when BLOCK_LOCAL_HTTP_CALLS is unset */
    it.each(["10.0.5.3", "192.168.1.1", "127.0.0.1"])(
      "admits private IP literal %s",
      async (hostname) => {
        await expect(validate(`http://${hostname}/`)).resolves.toMatchObject({
          type: "resolved",
        });
      },
    );
  });

  describe('given BLOCK_LOCAL_HTTP_CALLS is "false"', () => {
    const validate = createSsrfUrlValidator({ blockLocal: false, allowedHosts: [] });

    /** @scenario <impl> allows private IP literals when BLOCK_LOCAL_HTTP_CALLS is "false" */
    it("admits a private IP literal", async () => {
      await expect(validate("http://10.0.0.5/")).resolves.toMatchObject({ type: "resolved" });
    });
  });

  describe('given BLOCK_LOCAL_HTTP_CALLS is "true"', () => {
    const validate = createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] });

    /** @scenario <impl> blocks private IP literals when BLOCK_LOCAL_HTTP_CALLS is "true" */
    it.each(["127.0.0.1", "10.0.5.3", "192.168.1.1", "0.0.0.0", "::1"])(
      "refuses private IP literal %s",
      async (hostname) => {
        const url =
          hostname === "::1" ? `http://[${hostname}]/` : `http://${hostname}/`;
        await expect(validate(url)).rejects.toThrow();
      },
    );

    /** @scenario <impl> blocks DNS rebinding to private IPs when BLOCK_LOCAL_HTTP_CALLS is "true" */
    it("refuses a hostname that resolves to a private IP", async () => {
      resolvesTo({ a: ["10.0.5.3"] });
      await expect(validate("http://internal.example.com/")).rejects.toThrow();
    });
  });

  describe("given ALLOWED_PROXY_HOSTS names a private host", () => {
    const validate = createSsrfUrlValidator({
      blockLocal: true,
      allowedHosts: ["10.0.5.3", "internal.example.com"],
    });

    /** @scenario <impl> allows allowlisted host even when BLOCK_LOCAL_HTTP_CALLS is "true" */
    it("admits the allowlisted host", async () => {
      await expect(validate("http://10.0.5.3/")).resolves.toMatchObject({
        type: "allowlisted",
      });
    });
  });

  describe("given NODE_ENV is production and ALLOWED_PROXY_HOSTS names a private host", () => {
    const validate = createSsrfUrlValidator({ blockLocal: true, allowedHosts: ["10.0.5.3"] });

    /** @scenario <impl> allowlist works in production NODE_ENV */
    it("admits the allowlisted host regardless of NODE_ENV", async () => {
      await expect(validate("http://10.0.5.3/api")).resolves.toMatchObject({
        type: "allowlisted",
      });
    });
  });

  describe("given ALLOWED_PROXY_HOSTS names a different host", () => {
    const validate = createSsrfUrlValidator({ blockLocal: true, allowedHosts: ["10.0.5.3"] });

    /** @scenario <impl> hostname not in allowlist is still blocked */
    it("still refuses a private host the allowlist does not name", async () => {
      await expect(validate("http://10.0.5.4/")).rejects.toThrow();
    });
  });

  describe("given a cloud metadata host", () => {
    /** @scenario <impl> blocks cloud metadata even when BLOCK_LOCAL_HTTP_CALLS is "false" */
    it.each(["169.254.169.254", "metadata.google.internal"])(
      "refuses %s even with local calls allowed",
      async (hostname) => {
        const validate = createSsrfUrlValidator({ blockLocal: false, allowedHosts: [] });
        await expect(validate(`http://${hostname}/`)).rejects.toThrow(/metadata/i);
      },
    );

    /** @scenario <impl> blocks cloud metadata even when host is in ALLOWED_PROXY_HOSTS */
    it("refuses it even when the allowlist names it", async () => {
      const validate = createSsrfUrlValidator({
        blockLocal: true,
        allowedHosts: ["169.254.169.254"],
      });
      await expect(validate("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
        /metadata/i,
      );
    });
  });
});
