/**
 * @vitest-environment node
 * Whether an address the deployment's broker asserted for a SAML subject counts as verified.
 * Spec: specs/identity/sso-brokered-saml-address.feature
 */
import {
  emptySsoConnection,
  type SsoConnectionState,
  type SsoDomainVerification,
  SsoConnectionNotFoundError,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { SsoConnectionReadRepository } from "../../../sso-connection/repositories/sso-connection.repository.ts";
import type { SsoRegistrantReads } from "../../rules/sso-assertion-contract.rules.ts";
import { SsoAssertionService } from "../sso-assertion.service.ts";

/** Answers the two reads the question makes from a held list, as the folded rows would. */
class HeldConnections extends SsoConnectionReadRepository {
  readonly asked: string[] = [];

  constructor(private readonly held: readonly SsoConnectionState[]) {
    super();
  }

  getConnection(): never {
    throw new Error("the brokered question never reads one connection by id");
  }

  async getDomainOwner({ domain }: { domain: string }) {
    this.asked.push(`owner:${domain}`);
    const owner = this.held.find(
      (connection) => connection.state === "ACTIVE" && connection.verifiedDomains.includes(domain),
    );
    if (!owner) throw new SsoConnectionNotFoundError(`no connection holds ${domain}`);
    return { connectionId: owner.connectionId, organizationId: owner.organizationId };
  }

  async findForOrganization({ organizationId }: { organizationId: string }) {
    this.asked.push(`organization:${organizationId}`);
    return this.held.filter((connection) => connection.organizationId === organizationId);
  }
}

class NoRegistrants implements SsoRegistrantReads {
  findRegistrantAtAddress(): never {
    throw new Error("the brokered question never asks for a registrant");
  }

  findBoundMemberIdentity(): never {
    throw new Error("the brokered question never asks for a bound identity");
  }
}

function proof(over: Partial<SsoDomainVerification> & { domain: string }): SsoDomainVerification {
  return {
    method: "dns-txt",
    actorId: null,
    verifiedAtMs: 1_756_000_000_000,
    proofState: "VERIFIED",
    firstAbsentAtMs: null,
    graceEndsAtMs: null,
    tokenHash: "sha256:proof",
    ...over,
  };
}

/** The connection the grandfather migration made from an organization's pin and domain. */
function grandfathered({
  organizationId,
  pin,
  domain,
  over = {},
}: {
  organizationId: string;
  pin: string;
  domain: string;
  over?: Partial<SsoConnectionState>;
}): SsoConnectionState {
  const base = emptySsoConnection({ connectionId: `ssoc_gf_${organizationId}` });
  return {
    ...base,
    organizationId,
    state: "ACTIVE",
    source: "legacy-grandfathered",
    verifiedDomains: [domain],
    domainVerifications: [proof({ domain, method: "legacy-configuration", tokenHash: null })],
    idpMetadata: { ...base.idpMetadata, providerId: pin },
    ...over,
  };
}

/** An organization's own connection, proved by a published record. */
function selfServe({
  organizationId,
  domain,
  over = {},
}: {
  organizationId: string;
  domain: string;
  over?: Partial<SsoConnectionState>;
}): SsoConnectionState {
  const base = emptySsoConnection({ connectionId: `local_ssoc_own_${organizationId}` });
  return {
    ...base,
    organizationId,
    state: "ACTIVE",
    source: "self-serve",
    verifiedDomains: [domain],
    domainVerifications: [proof({ domain })],
    idpMetadata: { ...base.idpMetadata, providerId: "okta" },
    ...over,
  };
}

function askOver(held: readonly SsoConnectionState[]) {
  const connections = new HeldConnections(held);
  const service = SsoAssertionService.create({ connections, registrants: new NoRegistrants() });
  return {
    connections,
    ask: (subject: string, email: string | null | undefined) =>
      service.isBrokeredAddressProved({ subject, email }),
  };
}

describe("SsoAssertionService.isBrokeredAddressProved", () => {
  describe("given the organization whose legacy route pins the subject's connection proved the domain", () => {
    /** @scenario "A brokered SAML address on the pinning organization's proved domain is verified" */
    it("answers yes when the legacy import proved it", async () => {
      const { ask } = askOver([
        grandfathered({ organizationId: "org_acme", pin: "samlp|acme", domain: "acme.com" }),
      ]);

      await expect(ask("samlp|acme|alice", "Alice@ACME.com")).resolves.toBe(true);
    });

    /** @scenario "A brokered SAML address on the pinning organization's proved domain is verified" */
    it("answers yes when the organization's own connection proved it during a cutover", async () => {
      const { ask } = askOver([
        selfServe({ organizationId: "org_acme", domain: "acme.com" }),
        grandfathered({
          organizationId: "org_acme",
          pin: "samlp|acme",
          domain: "acme.io",
        }),
      ]);

      await expect(ask("samlp|acme|alice", "alice@acme.com")).resolves.toBe(true);
    });
  });

  describe("given the domain belongs to a different organization", () => {
    /** @scenario "A brokered SAML address on another organization's domain is not verified" */
    it("answers no", async () => {
      const { ask } = askOver([
        grandfathered({ organizationId: "org_acme", pin: "samlp|acme", domain: "acme.com" }),
        selfServe({ organizationId: "org_globex", domain: "globex.com" }),
      ]);

      await expect(ask("samlp|acme|bob", "bob@globex.com")).resolves.toBe(false);
    });
  });

  describe("given nobody proved the domain", () => {
    /** @scenario "A brokered SAML address on a domain nobody proved is not verified" */
    it("answers no", async () => {
      const { ask } = askOver([
        grandfathered({ organizationId: "org_acme", pin: "samlp|acme", domain: "acme.com" }),
      ]);

      await expect(ask("samlp|acme|carol", "carol@unclaimed.example")).resolves.toBe(false);
    });
  });

  describe("given the subject came through a connection the organization does not pin", () => {
    /** @scenario "A brokered SAML subject from a connection the organization does not pin is not verified" */
    it.each(["samlp|acme-two|dan", "samlp|other|dan", "auth0|samlp|acme|dan"])(
      "answers no for %s",
      async (subject) => {
        const { ask } = askOver([
          grandfathered({ organizationId: "org_acme", pin: "samlp|acme", domain: "acme.com" }),
        ]);

        await expect(ask(subject, "dan@acme.com")).resolves.toBe(false);
      },
    );
  });

  describe("given the legacy route pins the broker or the strategy rather than one connection", () => {
    /** @scenario "A pin naming only the broker or the SAML strategy verifies nobody" */
    it.each(["auth0", "samlp"])("answers no for a pin of %s", async (pin) => {
      const { ask } = askOver([
        grandfathered({ organizationId: "org_acme", pin, domain: "acme.com" }),
      ]);

      await expect(ask("samlp|acme|erin", "erin@acme.com")).resolves.toBe(false);
    });
  });

  describe("given the proof lapsed or the legacy route is no longer live", () => {
    /** @scenario "A lapsed domain proof or a legacy route that is no longer live verifies nobody" */
    it("answers no when the proving connection's record lapsed", async () => {
      const { ask } = askOver([
        selfServe({
          organizationId: "org_acme",
          domain: "acme.com",
          over: {
            domainVerifications: [proof({ domain: "acme.com", proofState: "LAPSED" })],
          },
        }),
        grandfathered({ organizationId: "org_acme", pin: "samlp|acme", domain: "acme.io" }),
      ]);

      await expect(ask("samlp|acme|frank", "frank@acme.com")).resolves.toBe(false);
    });

    /** @scenario "A lapsed domain proof or a legacy route that is no longer live verifies nobody" */
    it("answers no when the pinning legacy route is suspended", async () => {
      const { ask } = askOver([
        selfServe({ organizationId: "org_acme", domain: "acme.com" }),
        grandfathered({
          organizationId: "org_acme",
          pin: "samlp|acme",
          domain: "acme.io",
          over: { state: "SUSPENDED" },
        }),
      ]);

      await expect(ask("samlp|acme|frank", "frank@acme.com")).resolves.toBe(false);
    });
  });

  describe("given the assertion carried no usable address", () => {
    /** @scenario "A brokered SAML subject with no address or no answer from identity is not verified" */
    it.each([null, undefined, "", "no-at-sign", "two@at@acme.com"])(
      "answers no for %s and reads nothing",
      async (email) => {
        const { ask, connections } = askOver([
          grandfathered({ organizationId: "org_acme", pin: "samlp|acme", domain: "acme.com" }),
        ]);

        await expect(ask("samlp|acme|gus", email)).resolves.toBe(false);
        expect(connections.asked).toEqual([]);
      },
    );
  });

  describe("given the connection reads fail for another reason", () => {
    it("lets the failure through rather than answering", async () => {
      const connections = new HeldConnections([]);
      connections.getDomainOwner = async () => {
        throw new Error("connection rows unreadable");
      };
      const service = SsoAssertionService.create({ connections, registrants: new NoRegistrants() });

      await expect(
        service.isBrokeredAddressProved({ subject: "samlp|acme|hal", email: "hal@acme.com" }),
      ).rejects.toThrow("connection rows unreadable");
    });
  });
});
