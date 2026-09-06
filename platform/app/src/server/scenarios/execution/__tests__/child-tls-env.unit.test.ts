/**
 * Unit tests for the scenario runner's TLS environment resolution.
 *
 * @see specs/scenarios/scenario-infra-error-surfacing.feature
 */

import { describe, expect, it } from "vitest";
import { resolveChildTlsEnv } from "../child-tls-env";

describe("resolveChildTlsEnv", () => {
  describe("when a trusted local CA is present", () => {
    /** @scenario "A trusted local CA is forwarded to the runner" */
    it("forwards NODE_EXTRA_CA_CERTS and never disables verification", () => {
      const result = resolveChildTlsEnv({
        isSaaS: false,
        nodeEnv: "development",
        nodeExtraCaCerts: "/home/dev/.portless/ca.pem",
      });
      expect(result.NODE_EXTRA_CA_CERTS).toBe("/home/dev/.portless/ca.pem");
      expect(result.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    });

    it("forwards the CA even in SaaS (a trusted CA is always safe)", () => {
      const result = resolveChildTlsEnv({
        isSaaS: true,
        nodeEnv: "production",
        nodeExtraCaCerts: "/etc/ssl/corp-ca.pem",
      });
      expect(result.NODE_EXTRA_CA_CERTS).toBe("/etc/ssl/corp-ca.pem");
      expect(result.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    });
  });

  describe("when no trusted CA is present", () => {
    /** @scenario "Local dev without a trusted CA relaxes TLS for the runner only" */
    it("relaxes TLS only in local, non-SaaS, non-production dev", () => {
      const result = resolveChildTlsEnv({
        isSaaS: false,
        nodeEnv: "development",
        nodeExtraCaCerts: undefined,
      });
      expect(result.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");
      expect(result.NODE_EXTRA_CA_CERTS).toBeUndefined();
    });

    it("treats an empty/whitespace CA path as absent", () => {
      const result = resolveChildTlsEnv({
        isSaaS: false,
        nodeEnv: "development",
        nodeExtraCaCerts: "   ",
      });
      expect(result.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");
      expect(result.NODE_EXTRA_CA_CERTS).toBeUndefined();
    });

    /** @scenario "A hosted deployment never relaxes TLS for the runner" */
    it("never relaxes TLS in SaaS", () => {
      const result = resolveChildTlsEnv({
        isSaaS: true,
        nodeEnv: "production",
        nodeExtraCaCerts: undefined,
      });
      expect(result).toEqual({});
    });

    it("never relaxes TLS in production even when IS_SAAS is false", () => {
      const result = resolveChildTlsEnv({
        isSaaS: false,
        nodeEnv: "production",
        nodeExtraCaCerts: undefined,
      });
      expect(result).toEqual({});
    });
  });
});
