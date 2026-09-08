import type {
  SsoConnectionCommand,
  SsoConnectionFactInput,
} from "@langwatch/identity";
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

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
const OPS = { type: "user" as const, id: "user_ops" };
const T0 = 1_756_000_000_000;

const identity = {
  tenantId: ORG,
  organizationId: ORG,
  connectionId: CONNECTION,
  commandId: "ssocmd_1",
  occurredAtMs: T0,
  actor: OPS,
  source: "self-serve" as const,
};

const IDP = {
  issuer: "https://login.acme.okta.com",
  providerId: "okta",
  clientIdRef: "cred_client",
  secretRef: "cred_secret",
  certRefs: [] as string[],
};

let connections: InMemoryConnections;
let committed: {
  command: SsoConnectionCommand;
  facts: SsoConnectionFactInput[];
}[];
let service: SsoConnectionService;

beforeEach(() => {
  connections = new InMemoryConnections();
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
      breakGlass: new StubBreakGlassBindings(true),
      stranding: new StubStranding([]),
      platformOperators: new StubPlatformOperators([OPS.id]),
    }),
    ledger,
  );
});

describe("the sso connection write surface", () => {
  describe("when an ops user changes a connection", () => {
    /** @scenario "Backoffice edits go through commands like everyone else's" */
    it("makes every change a guarded command with the actor on it", async () => {
      await service.registerConnection({
        ...identity,
        type: "oidc",
        idp: IDP,
        allowsJit: true,
      });
      await service.claimDomain({
        ...identity,
        commandId: "ssocmd_2",
        domain: "acme.com",
      });
      await service.approveDomainClaim({
        ...identity,
        commandId: "ssocmd_3",
        domain: "acme.com",
      });
      await service.requestVerification({
        ...identity,
        commandId: "ssocmd_4",
        domain: "acme.com",
        method: "dns-txt",
        tokenHash: "sha256:proof",
      });
      await service.verifyDomain({
        ...identity,
        commandId: "ssocmd_5",
        domain: "acme.com",
      });
      await service.activateConnection({
        ...identity,
        commandId: "ssocmd_6",
        testLoginAccountId: "acc_test",
      });
      await service.suspendConnection({
        ...identity,
        commandId: "ssocmd_7",
        reason: "IdP maintenance",
      });
      await service.resumeConnection({ ...identity, commandId: "ssocmd_8" });

      // Every verb reached the ledger as a COMMAND — nothing wrote state on
      // its own — and every fact it stated names the operator who caused it.
      expect(committed.map((entry) => entry.command.type)).toEqual([
        "lw.identity.register_connection",
        "lw.identity.claim_domain",
        "lw.identity.approve_domain_claim",
        "lw.identity.request_verification",
        "lw.identity.verify_domain",
        "lw.identity.activate_connection",
        "lw.identity.suspend_connection",
        "lw.identity.resume_connection",
      ]);
      for (const entry of committed) {
        expect(entry.command.data.actor).toEqual(OPS);
        for (const fact of entry.facts) {
          expect(fact.data.actor).toEqual(OPS);
        }
      }
      expect(
        (await connections.findConnection({ connectionId: CONNECTION }))?.state,
      ).toBe("ACTIVE");
    });

    /** @scenario "Backoffice edits go through commands like everyone else's" */
    it("refuses a command the lifecycle forbids rather than writing state", async () => {
      await service.registerConnection({
        ...identity,
        type: "oidc",
        idp: IDP,
        allowsJit: true,
      });
      committed = [];

      await expect(
        service.activateConnection({
          ...identity,
          commandId: "ssocmd_9",
          testLoginAccountId: "acc_test",
        }),
      ).rejects.toMatchObject({ code: "sso_connection_invalid_transition" });
      expect(committed).toEqual([]);
    });

    /** @scenario "Backoffice edits go through commands like everyone else's" */
    it("never reaches the ledger when the guard states nothing", async () => {
      await service.registerConnection({
        ...identity,
        type: "oidc",
        idp: IDP,
        allowsJit: true,
      });
      committed = [];

      // The same registration again: the connection already exists, so there
      // is nothing to state and nothing to write.
      const facts = await service.registerConnection({
        ...identity,
        type: "oidc",
        idp: IDP,
        allowsJit: true,
      });

      expect(facts).toEqual([]);
      expect(committed).toEqual([]);
    });
  });
});
