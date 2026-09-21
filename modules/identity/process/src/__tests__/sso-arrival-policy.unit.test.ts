/**
 * Who a connection admits, in three answers (ADR-117 §3). Unbound on
 * purpose: the scenarios are upstream's `specs/identity/sso-activation.feature`,
 * which `enterprise/modules/sso` owns here and has not ported yet.
 */
import {
  CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
  DEFAULT_SSO_ARRIVAL_POLICY,
  emptySsoConnection,
  reduceSsoConnection,
  type SsoConnectionFactInput,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections.ts";

const ORG = "org_acme";
const CONNECTION = "ssoc_acme";
const ANA = { type: "user" as const, id: "user_ana" };
const T0 = 1_756_000_000_000;

let connections: InMemoryConnections;
let guards: SsoConnectionGuardsService;

const command = (occurredAtMs: number) => ({
  tenantId: ORG,
  organizationId: ORG,
  connectionId: CONNECTION,
  commandId: `ssocmd_${occurredAtMs}`,
  occurredAtMs,
  actor: ANA,
  source: "self-serve" as const,
});

const apply = (facts: SsoConnectionFactInput[], occurredAt: number) =>
  connections.apply({ connectionId: CONNECTION, facts, occurredAt });

beforeEach(() => {
  connections = new InMemoryConnections();
  guards = SsoConnectionGuardsService.create({
    connections,
    breakGlass: new StubBreakGlassBindings(true),
    stranding: new StubStranding(),
    platformOperators: new StubPlatformOperators(),
  });
});

describe("who a connection admits", () => {
  describe("when one is registered", () => {
    /** @scenario "A registered connection carries the arrival answer registration stated" */
    it("carries the answer registration stated, and nobody has decided yet", async () => {
      const facts = await guards.registerConnection({
        ...command(T0),
        type: "oidc",
        idp: {
          issuer: null,
          providerId: "okta",
          clientIdRef: null,
          secretRef: null,
          certRefs: [],
        },
        arrivalPolicy: "refuse",
      });

      const state = apply(facts, T0);
      expect(state.arrivalPolicy).toBe("refuse");
      expect(state.arrivalPolicyDecidedAtMs).toBeNull();
    });

    /** @scenario "A connection nobody has answered for turns arrivals away" */
    it("defaults to turning arrivals away, which is the answer that surprises nobody", () => {
      expect(emptySsoConnection({ connectionId: CONNECTION }).arrivalPolicy).toBe(
        DEFAULT_SSO_ARRIVAL_POLICY,
      );
      expect(DEFAULT_SSO_ARRIVAL_POLICY).toBe("refuse");
    });
  });

  describe("when somebody decides", () => {
    beforeEach(() => {
      connections.seed({
        ...emptySsoConnection({ connectionId: CONNECTION }),
        organizationId: ORG,
        state: "VERIFIED",
        verifiedDomains: ["acme.com"],
      });
    });

    /** @scenario "The middle answer is recorded as itself, not as a boolean either side of it" */
    it("records the middle answer as itself, not as a boolean either side of it", async () => {
      const facts = await guards.setArrivalPolicy({ ...command(T0), policy: "request" });

      expect(facts).toEqual([
        {
          type: CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
          data: {
            connectionId: CONNECTION,
            policy: "request",
            actor: ANA,
            source: "self-serve",
          },
        },
      ]);
      const state = apply(facts, T0);
      expect(state.arrivalPolicy).toBe("request");
      expect(state.arrivalPolicyDecidedAtMs).toBe(T0);
    });

    /** @scenario "Confirming the same arrival answer twice records nothing, and changing it records a decision" */
    it("says nothing when the same answer is confirmed twice, and moves on a change", async () => {
      apply(await guards.setArrivalPolicy({ ...command(T0), policy: "admit" }), T0);

      expect(await guards.setArrivalPolicy({ ...command(T0 + 1_000), policy: "admit" })).toEqual(
        [],
      );

      const changed = await guards.setArrivalPolicy({ ...command(T0 + 2_000), policy: "refuse" });
      const state = apply(changed, T0 + 2_000);
      expect(state.arrivalPolicy).toBe("refuse");
      expect(state.arrivalPolicyDecidedAtMs).toBe(T0 + 2_000);
    });

    /** @scenario "Saying it out loud is a fact even where the behaviour is the same" */
    it("counts confirming the registration default as a decision", async () => {
      const facts = await guards.setArrivalPolicy({ ...command(T0), policy: "refuse" });

      expect(facts).toHaveLength(1);
      expect(apply(facts, T0).arrivalPolicyDecidedAtMs).toBe(T0);
    });
  });

  describe("given a connection that has been torn down", () => {
    /** @scenario "A torn-down connection refuses an arrival decision by name" */
    it("refuses the decision by name rather than changing a dead connection", async () => {
      connections.seed({
        ...emptySsoConnection({ connectionId: CONNECTION }),
        organizationId: ORG,
        state: "TORN_DOWN",
      });

      await expect(
        guards.setArrivalPolicy({ ...command(T0), policy: "admit" }),
      ).rejects.toMatchObject({ code: "sso_connection_invalid_transition" });
    });
  });

  describe("given the fold has no answer for a fact it has never seen", () => {
    it("leaves everything else the reducer knows exactly where it was", () => {
      const before = {
        ...emptySsoConnection({ connectionId: CONNECTION }),
        organizationId: ORG,
        state: "ACTIVE" as const,
        verifiedDomains: ["acme.com"],
      };

      const after = reduceSsoConnection({
        state: before,
        fact: {
          type: CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
          data: {
            connectionId: CONNECTION,
            policy: "request",
            actor: ANA,
            source: "self-serve",
          },
          occurredAt: T0,
        },
      });

      expect(after).toMatchObject({
        state: "ACTIVE",
        verifiedDomains: ["acme.com"],
        arrivalPolicy: "request",
      });
    });
  });
});
