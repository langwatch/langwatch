import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  type SsoConnectionFactInput,
  type SsoConnectionLifecycleState,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import type { SsoConnectionLedger } from "../rules/sso-connection-ledger.rules.ts";
import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import { SsoConnectionService } from "../services/sso-connection.service.ts";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubPlatformOperators,
  StubStranding,
  licensingFixture,
} from "./support/in-memory-connections.ts";

/**
 * The three onboarding tiers are three ways to state the same facts: the
 * lifecycle one connection walks does not depend on who walked it.
 */

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
const DOMAIN = "acme.com";
const T0 = 1_756_000_000_000;
const OLIVE = { type: "user" as const, id: "user_olive" };
const ANA = { type: "user" as const, id: "user_ana" };

const IDP = {
  issuer: "https://login.acme.okta.com",
  providerId: "okta",
  clientIdRef: "cred_client",
  secretRef: "cred_secret",
  certRefs: [],
};

/** Every state a connection can stand in on the way to live traffic, in the
 *  order the lifecycle reaches them. */
const JOURNEY: readonly SsoConnectionLifecycleState[] = [
  "DRAFT",
  "CLAIMED",
  "APPROVED",
  "VERIFICATION_PENDING",
  "VERIFIED",
  "ACTIVE",
];

interface Walk {
  states: SsoConnectionLifecycleState[];
  factTypes: string[];
  step: (run: () => Promise<unknown>) => Promise<void>;
  commandFor: (commandId: string, actor: typeof OLIVE) => ReturnType<typeof identityOf>;
  service: SsoConnectionService;
}

const identityOf = (commandId: string, actor: typeof OLIVE) => ({
  tenantId: ORG,
  organizationId: ORG,
  connectionId: CONNECTION,
  commandId,
  occurredAtMs: T0,
  actor,
  source: "self-serve" as const,
});

function startWalk({ licensed }: { licensed: boolean }): Walk {
  const connections = new InMemoryConnections();
  const states: SsoConnectionLifecycleState[] = [];
  const factTypes: string[] = [];
  const ledger: SsoConnectionLedger = {
    async commit({ command, facts }) {
      connections.apply({
        connectionId: command.data.connectionId,
        facts,
        occurredAt: command.data.occurredAtMs,
      });
      factTypes.push(...facts.map((fact: SsoConnectionFactInput) => fact.type));
      return facts.map((fact) => ({ ...fact, occurredAt: command.data.occurredAtMs }));
    },
  };
  const service = SsoConnectionService.create(
    SsoConnectionGuardsService.create({
      connections,
      registrationSlots: connections,
      breakGlass: new StubBreakGlassBindings(true),
      stranding: new StubStranding([]),
      authorization: new StubPlatformOperators([OLIVE.id]),
      licensing: licensingFixture({ authorizesDomainClaims: licensed }),
    }),
    ledger,
  );

  return {
    states,
    factTypes,
    service,
    commandFor: identityOf,
    step: async (run) => {
      await run();
      const held = await connections.getConnection({ connectionId: CONNECTION });
      if (states.at(-1) !== held.state) states.push(held.state);
    },
  };
}

/** The same attempt to go live, made before the domain is proved. */
async function activateEarly(walk: Walk, actor: typeof OLIVE): Promise<unknown> {
  return walk.service
    .activateConnection({
      ...walk.commandFor("ssocmd_early", actor),
      testLoginAccountId: "acc_test",
    })
    .then(
      () => "activated",
      (error: { code?: string }) => error.code,
    );
}

/** Each tier's own way to prove the domain, ending in live traffic. */
const TIERS: {
  name: string;
  actor: typeof OLIVE;
  licensed: boolean;
  prove: (walk: Walk) => Promise<void>;
}[] = [
  {
    name: "an operator attesting the domain",
    actor: OLIVE,
    licensed: false,
    prove: async (walk) => {
      const { service, commandFor, step } = walk;
      await step(() =>
        service.approveDomainClaim({ ...commandFor("ssocmd_3", OLIVE), domain: DOMAIN }),
      );
      await step(() =>
        service.attestDomain({
          ...commandFor("ssocmd_4", OLIVE),
          domain: DOMAIN,
          evidenceRef: "SUP-1234",
          note: "Checked the registrar record",
        }),
      );
    },
  },
  {
    name: "a licensed self-hosted administrator",
    actor: ANA,
    licensed: true,
    prove: async (walk) => {
      const { service, commandFor, step } = walk;
      await step(() =>
        service.requestVerification({
          ...commandFor("ssocmd_3", ANA),
          domain: DOMAIN,
          method: "license-token",
          tokenHash: "sha256:licence",
        }),
      );
      await step(() => service.verifyDomain({ ...commandFor("ssocmd_4", ANA), domain: DOMAIN }));
    },
  },
  {
    name: "a reviewed claim proved by the published record",
    actor: ANA,
    licensed: false,
    prove: async (walk) => {
      const { service, commandFor, step } = walk;
      await step(() =>
        service.approveDomainClaim({ ...commandFor("ssocmd_3", OLIVE), domain: DOMAIN }),
      );
      await step(() =>
        service.requestVerification({
          ...commandFor("ssocmd_4", ANA),
          domain: DOMAIN,
          method: "dns-txt",
          tokenHash: "sha256:record",
        }),
      );
      await step(() => service.verifyDomain({ ...commandFor("ssocmd_5", ANA), domain: DOMAIN }));
    },
  },
];

describe("given a connection that reached live traffic through each of the three tiers", () => {
  /** @scenario "Every tier drives one connection through one lifecycle" */
  it("records its states in the one order, and no tier skips the guard on going live", async () => {
    const walks: { name: string; walk: Walk; early: unknown }[] = [];

    for (const tier of TIERS) {
      const walk = startWalk({ licensed: tier.licensed });
      await walk.step(() =>
        walk.service.registerConnection({
          ...walk.commandFor("ssocmd_1", tier.actor),
          type: "oidc",
          idp: IDP,
          arrivalPolicy: "admit",
        }),
      );
      await walk.step(() =>
        walk.service.claimDomain({ ...walk.commandFor("ssocmd_2", tier.actor), domain: DOMAIN }),
      );
      const early = await activateEarly(walk, tier.actor);
      await tier.prove(walk);
      await walk.step(() =>
        walk.service.activateConnection({
          ...walk.commandFor("ssocmd_9", tier.actor),
          testLoginAccountId: "acc_test",
        }),
      );
      walks.push({ name: tier.name, walk, early });
    }

    for (const { name, walk, early } of walks) {
      const ranks = walk.states.map((state) => JOURNEY.indexOf(state));
      // Every recorded state is one the shared lifecycle names, each reached
      // after the one before it and never twice.
      expect(ranks, name).not.toContain(-1);
      expect(ranks, name).toEqual(ranks.toSorted((a, b) => a - b));
      expect(new Set(ranks).size, name).toBe(ranks.length);
      expect(walk.states[0], name).toBe("DRAFT");
      expect(walk.states.at(-1), name).toBe("ACTIVE");
      // Going live before the domain was proved was refused the same way.
      expect(early, name).toBe("sso_connection_invalid_transition");
      expect(
        walk.factTypes.filter((type) => type === CONNECTION_ACTIVATED_EVENT_TYPE),
        name,
      ).toHaveLength(1);
    }
    expect(new Set(walks.map(({ walk }) => walk.states.at(-2))).size).toBe(1);
  });
});
