import type {
  SsoConnectionCommand,
  SsoConnectionFactInput,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";
import { SsoConnectionGuards } from "../sso-connection-guards";
import type { SsoConnectionLedger } from "../sso-connection-ledger";
import { SsoConnectionService } from "../sso-connection.service";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections";

/**
 * D05 tier 1 end to end at the write surface: an operator takes a customer
 * from nothing to a connection ready to go live, in one sitting, through the
 * real service and the real guards.
 *
 * Integration rather than unit because it is the composition under test —
 * service, guards and the fold together — not any one of them. The ledger is
 * the seam a datastore would sit behind; everything above it is production
 * code.
 */

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
const OLIVE = { type: "user" as const, id: "user_olive" };
const T0 = 1_756_000_000_000;

const IDP = {
  issuer: "https://login.acme.okta.com",
  providerId: "okta",
  clientIdRef: "cred_client",
  secretRef: "cred_secret",
  certRefs: [],
};

/** One command's identity block, with the operator on it. Each verb gets its
 *  own commandId, exactly as a caller minting them per action would. */
const commandFor = (commandId: string) => ({
  tenantId: ORG,
  organizationId: ORG,
  connectionId: CONNECTION,
  commandId,
  occurredAtMs: T0,
  actor: OLIVE,
  source: "self-serve" as const,
});

let connections: InMemoryConnections;
let breakGlass: StubBreakGlassBindings;
let committed: {
  command: SsoConnectionCommand;
  facts: SsoConnectionFactInput[];
}[];
let service: SsoConnectionService;

beforeEach(() => {
  connections = new InMemoryConnections();
  breakGlass = new StubBreakGlassBindings(true);
  committed = [];
  const ledger: SsoConnectionLedger = {
    async commit({ command, facts }) {
      committed.push({ command, facts });
      connections.apply({
        connectionId: command.data.connectionId,
        facts,
        occurredAt: command.data.occurredAtMs,
      });
      return facts.map((fact) => ({
        ...fact,
        occurredAt: command.data.occurredAtMs,
      }));
    },
  };
  service = new SsoConnectionService(
    new SsoConnectionGuards({
      connections,
      breakGlass,
      stranding: new StubStranding([]),
      platformOperators: new StubPlatformOperators([OLIVE.id]),
    }),
    ledger,
  );
});

/** Register, claim, approve, attest — the whole of what tier 1 asks of an
 *  operator, and the whole of what it asks of anybody. */
async function onboard(): Promise<void> {
  await service.registerConnection({
    ...commandFor("ssocmd_1"),
    type: "oidc",
    idp: IDP,
    allowsJit: true,
  });
  await service.claimDomain({ ...commandFor("ssocmd_2"), domain: "acme.com" });
  await service.approveDomainClaim({
    ...commandFor("ssocmd_3"),
    domain: "acme.com",
  });
  await service.attestDomain({
    ...commandFor("ssocmd_4"),
    domain: "acme.com",
  });
}

describe("ops-assisted onboarding", () => {
  describe("when an operator sets a customer up from the back office", () => {
    /** @scenario "An operator takes a customer from nothing to a connection ready to go live" */
    it("reaches a connection ready to activate, every step a separate fact naming the operator", async () => {
      await onboard();

      const held = await connections.findConnection({
        connectionId: CONNECTION,
      });
      // Ready to activate: the state activation is commandable from, with the
      // domain proved. Nothing else stands between here and live traffic
      // except the test sign-in, which is a person signing in.
      expect(held?.state).toBe("VERIFIED");
      expect(held?.verifiedDomains).toEqual(["acme.com"]);

      // Four commands, four separate facts, in order, each naming Olive.
      expect(committed.map((entry) => entry.command.type)).toEqual([
        "lw.identity.register_connection",
        "lw.identity.claim_domain",
        "lw.identity.approve_domain_claim",
        "lw.identity.attest_domain",
      ]);
      for (const entry of committed) {
        expect(entry.facts).toHaveLength(1);
        expect(entry.facts[0]!.data).toMatchObject({ actor: OLIVE });
      }
    });

    /** @scenario "Setting a customer up asks the customer for nothing until they sign in" */
    it("leaves a test sign-in as the only thing still wanted from the customer", async () => {
      await onboard();

      const held = await connections.findConnection({
        connectionId: CONNECTION,
      });
      // Nothing is pending against the customer: no ceremony was ever opened,
      // so there is no record for them to publish and no token outstanding.
      expect(held?.pendingVerification).toBeNull();
      expect(held?.verifiedDomains).toEqual(["acme.com"]);
      expect(held?.state).toBe("VERIFIED");

      // The one thing still missing is the test sign-in, and activation says
      // so by refusing without it.
      expect(held?.testLoginAccountId).toBeNull();
      await expect(
        service.activateConnection({
          ...commandFor("ssocmd_5"),
          testLoginAccountId: null,
        }),
      ).rejects.toMatchObject({
        code: "sso_connection_activation_blocked",
      });

      // Nobody ever asked the customer to publish anything or to wait: no
      // verification was requested, and no claim was left undecided.
      expect(committed.map((entry) => entry.command.type)).not.toContain(
        "lw.identity.request_verification",
      );
      expect(held?.claimedDomains).toEqual([]);
    });

    /** @scenario "What proved the domain is on the connection wherever it is read" */
    it("says on the connection that the domain was attested, by whom and when", async () => {
      await onboard();

      const held = await connections.findConnection({
        connectionId: CONNECTION,
      });
      // The method rides on the connection, not only in the log — so the back
      // office and the operator lookup read the same answer without either
      // one having to replay history.
      expect(held?.domainVerifications).toEqual([
        {
          domain: "acme.com",
          method: "operator-attested",
          actorId: OLIVE.id,
          verifiedAtMs: T0,
        },
      ]);
      // And it never reads as a domain the customer proved: the method is a
      // value of its own, so there is no reading of this row under which the
      // weaker evidence disappears.
      expect(held?.domainVerifications[0]!.method).not.toBe("dns-txt");
    });

    /** @scenario "A tier that has not shipped never blocks one that has" */
    it("reaches live traffic with nothing in the journey waiting on a queue", async () => {
      await onboard();
      await service.activateConnection({
        ...commandFor("ssocmd_5"),
        testLoginAccountId: "acc_test",
      });

      const held = await connections.findConnection({
        connectionId: CONNECTION,
      });
      expect(held?.state).toBe("ACTIVE");
      expect(held?.verifiedDomains).toEqual(["acme.com"]);

      // Nothing waited: every command in the journey was decided the moment
      // it was issued, and none of them left the connection in a state whose
      // exit is somebody else's action. In particular the claim never sat
      // CLAIMED waiting for a reviewer — the operator who made it decided it.
      expect(committed).toHaveLength(5);
      expect(committed.map((entry) => entry.command.type)).not.toContain(
        "lw.identity.request_verification",
      );
    });

    /** @scenario "Activation from the back office needs everything activation ever needs" */
    it("refuses activation without a test sign-in or a way back in, naming the code", async () => {
      await onboard();

      // The domain is proved, but nobody has completed a test sign-in.
      await expect(
        service.activateConnection({
          ...commandFor("ssocmd_5"),
          testLoginAccountId: null,
        }),
      ).rejects.toMatchObject({
        code: "sso_connection_activation_blocked",
      });

      // And with the test sign-in but no way in that does not use the
      // identity provider, the same refusal — an operator's attestation buys
      // no exemption from the guard that prevents a lockout.
      breakGlass.set(false);
      await expect(
        service.activateConnection({
          ...commandFor("ssocmd_6"),
          testLoginAccountId: "acc_test",
        }),
      ).rejects.toMatchObject({
        code: "sso_connection_activation_blocked",
      });

      const held = await connections.findConnection({
        connectionId: CONNECTION,
      });
      expect(held?.state).toBe("VERIFIED");
    });
  });
});
