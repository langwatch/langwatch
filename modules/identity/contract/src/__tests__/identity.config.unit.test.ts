/**
 * Spec: specs/identity/sso-domain-verification.feature
 */
import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { identityConfig } from "../identity.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "identity", config: identityConfig }], environment })
    .identity;

describe("identity server configuration", () => {
  describe("given a deployment names no nameserver for domain proofs", () => {
    /** @scenario "The record is read before the domain is proved" */
    it("names none, so the lookup asks the machine's own resolver", () => {
      expect(read({}).ssoDomainProofDnsServers).toEqual([]);
      expect(read({ SSO_DOMAIN_PROOF_DNS_SERVERS: "  " }).ssoDomainProofDnsServers).toEqual([]);
    });
  });

  describe("given a development stack points domain proofs at its simulator", () => {
    /** @scenario "The record is read before the domain is proved" */
    it("reads the list the resolver is set from, trimmed and without blanks", () => {
      expect(
        read({ SSO_DOMAIN_PROOF_DNS_SERVERS: "127.0.0.1:15353, ::1, " }).ssoDomainProofDnsServers,
      ).toEqual(["127.0.0.1:15353", "::1"]);
    });
  });
});
