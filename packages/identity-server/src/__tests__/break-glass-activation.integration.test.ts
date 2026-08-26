import type {
  SsoConnectionCommand,
  SsoConnectionFactInput,
} from "@langwatch/identity";
import { beforeEach, describe, expect, it } from "vitest";
import { SsoBreakGlassService } from "../break-glass.service";
import { SsoConnectionGuards } from "../sso-connection-guards";
import type { SsoConnectionLedger } from "../sso-connection-ledger";
import { SsoConnectionService } from "../sso-connection.service";
import {
  CollectingBreakGlassNotifier,
  InMemoryBreakGlassBindings,
} from "./support/in-memory-break-glass";
import {
  InMemoryConnections,
  StubLicenseAuthority,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections";

/**
 * Activation and the way back in, composed (D05).
 *
 * The break-glass SERVICE is the activation port here, not a stub — which is
 * the point of the test. D04 shipped the requirement against a port whose
 * implementation was "does this deployment still hold a local door at all";
 * D05 makes real bindings the answer, and nothing about the guard, the
 * command or the lifecycle changed to make that happen. This test is what
 * says so.
 */

const ORG = "org_acme";
const OLIVE = { type: "user" as const, id: "user_olive" };
const ANA = { type: "user" as const, id: "user_ana" };
const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = 1_756_000_000_000;

const IDP = {
  issuer: "https://login.acme.okta.com",
  providerId: "okta",
  clientIdRef: null,
  secretRef: null,
  certRefs: [],
};

let connections: InMemoryConnections;
let bindings: InMemoryBreakGlassBindings;
let breakGlass: SsoBreakGlassService;
let connectionId: string;
let clock: number;
let minted: number;
let service: SsoConnectionService;

const command = (commandId: string) => ({
  tenantId: ORG,
  organizationId: ORG,
  connectionId,
  commandId,
  occurredAtMs: clock,
  actor: OLIVE,
  source: "self-serve" as const,
});

beforeEach(async () => {
  connections = new InMemoryConnections();
  bindings = new InMemoryBreakGlassBindings();
  connectionId = "ssoc_acme";
  clock = T0;
  minted = 0;
  breakGlass = new SsoBreakGlassService({
    bindings,
    notifier: new CollectingBreakGlassNotifier(),
    newBindingId: () => `ssobg_${++minted}`,
    // This suite is about activation reading bindings, never about revoking
    // them, so the revoke guard's one outside fact answers quietly.
    organizationHasActiveConnection: async () => false,
    // Everybody this suite grants to is an administrator of the organization
    // it grants in; the eligibility refusal has its own cases next door.
    holderIsEligible: async () => true,
    now: () => clock,
  });
  const ledger: SsoConnectionLedger = {
    async commit({
      command: issued,
      facts,
    }: {
      command: SsoConnectionCommand;
      facts: SsoConnectionFactInput[];
    }) {
      connections.apply({
        connectionId: issued.data.connectionId,
        facts,
        occurredAt: issued.data.occurredAtMs,
      });
      return facts.map((fact) => ({
        ...fact,
        occurredAt: issued.data.occurredAtMs,
      }));
    },
  };
  service = new SsoConnectionService(
    new SsoConnectionGuards({
      connections,
      // The real service, as the real composition wires it.
      breakGlass,
      stranding: new StubStranding([]),
      platformOperators: new StubPlatformOperators([OLIVE.id]),
      licenseAuthority: new StubLicenseAuthority(false),
    }),
    ledger,
  );

  // A connection with a proved domain, one step from live traffic.
  await service.registerConnection({
    ...command("ssocmd_1"),
    type: "oidc",
    idp: IDP,
    allowsJit: false,
  });
  await service.claimDomain({ ...command("ssocmd_2"), domain: "acme.com" });
  await service.approveDomainClaim({
    ...command("ssocmd_3"),
    domain: "acme.com",
  });
  await service.attestDomain({ ...command("ssocmd_4"), domain: "acme.com" });
});

const activate = (commandId: string) =>
  service.activateConnection({
    ...command(commandId),
    testLoginAccountId: "acc_test",
  });

describe("activation and the way back in", () => {
  describe("given nobody holds a way in that does not use the identity provider", () => {
    /** @scenario "Activation needs somebody who can still get in without the identity provider" */
    it("refuses activation by name until somebody is granted one with a date it ends", async () => {
      await expect(activate("ssocmd_5")).rejects.toMatchObject({
        code: "sso_connection_activation_blocked",
      });
      expect(
        (await connections.findConnection({ connectionId }))?.state,
      ).toBe("VERIFIED");

      // Granting somebody that way in, with a date it ends, makes activation
      // available — on any tier, because the guard is the same one.
      await breakGlass.grant({
        organizationId: ORG,
        userId: ANA.id,
        grantedByUserId: OLIVE.id,
        expiresAtMs: clock + 14 * DAY_MS,
      });

      await activate("ssocmd_6");
      expect(
        (await connections.findConnection({ connectionId }))?.state,
      ).toBe("ACTIVE");
    });

    it("refuses a later activation once the granted way in has ended", async () => {
      const granted = await breakGlass.grant({
        organizationId: ORG,
        userId: ANA.id,
        grantedByUserId: OLIVE.id,
        expiresAtMs: clock + 14 * DAY_MS,
      });
      expect(await breakGlass.hasLiveBinding({ organizationId: ORG })).toBe(
        true,
      );

      // The date arrives, and nobody acts. Activation is refused for the
      // same reason it was before anybody was granted anything — which is
      // the whole of what "it ends on its own date" has to mean.
      clock = granted.expiresAtMs;
      await expect(activate("ssocmd_5")).rejects.toMatchObject({
        code: "sso_connection_activation_blocked",
      });
      expect(
        (await connections.findConnection({ connectionId }))?.state,
      ).toBe("VERIFIED");
    });
  });

  describe("when a way back in is renewed", () => {
    /** @scenario "Renewing a way back in is deliberate and recorded" */
    it("records who granted it, to whom and until when, and leaves the previous end date readable", async () => {
      const first = await breakGlass.grant({
        organizationId: ORG,
        userId: ANA.id,
        grantedByUserId: OLIVE.id,
        expiresAtMs: T0 + 14 * DAY_MS,
      });

      clock = T0 + 13 * DAY_MS;
      const { renewed, replaced } = await breakGlass.renew({
        bindingId: first.bindingId,
        organizationId: ORG,
        grantedByUserId: "user_dana",
        expiresAtMs: T0 + 30 * DAY_MS,
      });

      // Who granted it, to whom, and until when — all three on the renewal,
      // and the grantor is recorded separately from the holder because a
      // renewal is a decision somebody made about somebody else.
      expect(renewed).toMatchObject({
        userId: ANA.id,
        grantedByUserId: "user_dana",
        expiresAtMs: T0 + 30 * DAY_MS,
        renewedFromBindingId: first.bindingId,
      });
      expect(replaced.expiresAtMs).toBe(T0 + 14 * DAY_MS);

      // The date it PREVIOUSLY ended is still readable: the renewal wrote a
      // new row rather than moving a column on the old one.
      const history = await breakGlass.history({ organizationId: ORG });
      expect(history.map((entry) => entry.expiresAtMs)).toEqual([
        T0 + 14 * DAY_MS,
        T0 + 30 * DAY_MS,
      ]);
      expect(history[0]?.supersededAtMs).toBe(clock);

      // And exactly one way in is live: the renewal, not both.
      expect(
        (await breakGlass.live({ organizationId: ORG })).map(
          (entry) => entry.bindingId,
        ),
      ).toEqual([renewed.bindingId]);

      // Activation still passes, on the renewed one.
      await activate("ssocmd_5");
      expect(
        (await connections.findConnection({ connectionId }))?.state,
      ).toBe("ACTIVE");
    });
  });
});
