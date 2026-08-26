import {
  disputedDomainClaimQueue,
  type SsoConnectionCommand,
  type SsoConnectionFactInput,
} from "@langwatch/identity";
import { beforeEach, describe, expect, it } from "vitest";
import { SsoConnectionGuards } from "../sso-connection-guards";
import type { SsoConnectionLedger } from "../sso-connection-ledger";
import { SsoConnectionService } from "../sso-connection.service";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubLicenseAuthority,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections";

/**
 * The claims waiting for LangWatch, and how long each has waited (D05 tier
 * 3).
 *
 * The wait is the thing under test rather than the list. Epic Open Q2 —
 * who staffs this queue and how fast — is unresolved and gates the tier, so
 * the number that would answer it has to exist from the first claim rather
 * than be added once somebody asks. A wait that only exists while a row is
 * unread would be no answer at all, which is why it is RECORDED when the
 * claim is decided and still readable long afterwards.
 */

const OLIVE = { type: "user" as const, id: "user_olive" };
const T0 = 1_756_000_000_000;
const HOUR_MS = 60 * 60 * 1000;

const IDP = {
  issuer: null,
  providerId: "okta",
  clientIdRef: null,
  secretRef: null,
  certRefs: [],
};

let connections: InMemoryConnections;
let clock: number;
let service: SsoConnectionService;

beforeEach(() => {
  connections = new InMemoryConnections();
  clock = T0;
  const ledger: SsoConnectionLedger = {
    async commit({
      command,
      facts,
    }: {
      command: SsoConnectionCommand;
      facts: SsoConnectionFactInput[];
    }) {
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
      platformOperators: new StubPlatformOperators([OLIVE.id]),
      licenseAuthority: new StubLicenseAuthority(false),
    }),
    ledger,
  );
});

/** One organization's administrator registers and claims their domain. */
async function claim({
  organizationId,
  connectionId,
  domain,
  atMs,
}: {
  organizationId: string;
  connectionId: string;
  domain: string;
  atMs: number;
}): Promise<void> {
  const identity = (commandId: string) => ({
    tenantId: organizationId,
    organizationId,
    connectionId,
    commandId,
    occurredAtMs: atMs,
    actor: { type: "user" as const, id: `user_${organizationId}` },
    source: "self-serve" as const,
  });
  await service.registerConnection({
    ...identity(`${connectionId}_register`),
    type: "oidc",
    idp: IDP,
    arrivalPolicy: "refuse",
  });
  await service.claimDomain({ ...identity(`${connectionId}_claim`), domain });
}

/**
 * The queue an operator actually works. Every domain here is held by some
 * other organization, which is what makes each claim a dispute — the one
 * question a published record cannot answer, and so the only thing left on
 * a person's desk.
 */
const CONTESTED = new Map([
  ["acme.com", "org_someone_else"],
  ["beta.example", "org_someone_else"],
  ["gamma.example", "org_someone_else"],
]);

const queueNow = () =>
  disputedDomainClaimQueue({
    connections: [...connections.all()],
    nowMs: clock,
    verifiedElsewhere: CONTESTED,
  });

describe("the domain claims waiting for LangWatch", () => {
  describe("given claims from several organizations are waiting", () => {
    beforeEach(async () => {
      await claim({
        organizationId: "org_beta",
        connectionId: "ssoc_beta",
        domain: "beta.example",
        atMs: T0 + 2 * HOUR_MS,
      });
      await claim({
        organizationId: "org_acme",
        connectionId: "ssoc_acme",
        domain: "acme.com",
        atMs: T0,
      });
      await claim({
        organizationId: "org_gamma",
        connectionId: "ssoc_gamma",
        domain: "gamma.example",
        atMs: T0 + HOUR_MS,
      });
      clock = T0 + 5 * HOUR_MS;
    });

    /** @scenario "How long a claim waited is recorded from the day the queue exists" */
    it("puts the longest-waiting claim first and records the wait so it reads back afterwards", async () => {
      const queue = queueNow();

      // Longest wait first, whatever order the claims arrived in.
      expect(queue.map((entry) => entry.domain)).toEqual([
        "acme.com",
        "gamma.example",
        "beta.example",
      ]);
      expect(queue.map((entry) => entry.waitedMs)).toEqual([
        5 * HOUR_MS,
        4 * HOUR_MS,
        3 * HOUR_MS,
      ]);
      // And whose claim each one is, so an operator can decide it.
      expect(queue[0]).toMatchObject({
        organizationId: "org_acme",
        connectionId: "ssoc_acme",
        claimedAtMs: T0,
      });

      // Deciding one takes it off the queue and FIXES its wait: how long
      // acme waited is answerable long after nobody is waiting.
      await service.approveDomainClaim({
        tenantId: "org_acme",
        organizationId: "org_acme",
        connectionId: "ssoc_acme",
        commandId: "ssocmd_approve",
        occurredAtMs: clock,
        actor: OLIVE,
        source: "self-serve",
        domain: "acme.com",
      });

      expect(queueNow().map((entry) => entry.domain)).toEqual([
        "gamma.example",
        "beta.example",
      ]);
      const decided = await connections.findConnection({
        connectionId: "ssoc_acme",
      });
      expect(decided?.domainClaims).toEqual([
        expect.objectContaining({
          domain: "acme.com",
          state: "APPROVED",
          claimedAtMs: T0,
          decidedAtMs: clock,
          waitedMs: 5 * HOUR_MS,
        }),
      ]);

      // Still 5 hours an hour later: the recorded wait is a measurement, not
      // a clock that keeps running once the waiting stopped.
      clock += HOUR_MS;
      const later = await connections.findConnection({
        connectionId: "ssoc_acme",
      });
      expect(later?.domainClaims[0]?.waitedMs).toBe(5 * HOUR_MS);
    });
  });
});
