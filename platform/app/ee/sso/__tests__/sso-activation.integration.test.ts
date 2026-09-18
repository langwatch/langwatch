// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  SsoArrivalPolicy,
  SsoConnectionCommand,
  SsoConnectionFactInput,
  SsoSelfServeContext,
} from "@langwatch/identity";
import { beforeEach, describe, expect, it } from "vitest";
import type { SsoSelfServeService } from "../sso-self-serve.service";
import type { InMemoryConnections } from "./support/in-memory-connections";
import {
  bindingFor,
  type StubBreakGlassReads,
  StubMembers,
  type StubTestSignIns,
} from "./support/in-memory-self-serve";
import {
  createSsoSelfServeFixture,
  type StubContext,
  type StubProofs,
} from "./support/sso-self-serve.fixture";

/** The setup checklist and activation guard run together against the real fold. */

const ORG = "org_acme";
const ANA = { userId: "user_ana" };
const BEN = { userId: "user_ben" };
const T0 = 1_756_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const HOSTED_OPTED_IN: SsoSelfServeContext = {
  deployment: "hosted",
  licensed: false,
  licenseActivatedSinceStart: false,
  optedIn: true,
};

const HOSTED_NOT_OPTED_IN: SsoSelfServeContext = {
  ...HOSTED_OPTED_IN,
  optedIn: false,
};

const OIDC_REGISTRATION = {
  protocol: "oidc" as const,
  issuer: "https://login.acme.okta.com",
  clientId: "client_acme",
  clientSecret: "secret_acme",
};

/**
 * A call that was expected to be refused. A two-handed `then` rather than a
 * `catch` so what is asserted on is the refusal alone.
 */
const refused = (): never => {
  throw new Error("the call was expected to be refused");
};

/** The code a refusal carries. Never its message — the message is copy. */
const codeOf = (error: unknown): unknown =>
  (error as { code?: unknown }).code ?? error;

let connections: InMemoryConnections;
let context: StubContext;
let testSignIns: StubTestSignIns;
let breakGlassReads: StubBreakGlassReads;
let proofs: StubProofs;
let members: StubMembers;
let committed: {
  command: SsoConnectionCommand;
  facts: SsoConnectionFactInput[];
}[];
let clock: number;
let selfServe: SsoSelfServeService;
let connectionId: string;

beforeEach(async () => {
  members = new StubMembers(
    [
      {
        userId: ANA.userId,
        name: "Ana",
        email: "ana@acme.com",
        holdsPassword: true,
      },
    ],
    [
      {
        userId: BEN.userId,
        name: "Ben",
        email: "ben@acme.com",
        holdsPassword: true,
      },
    ],
  );
  clock = T0;
  ({
    connections,
    context,
    testSignIns,
    breakGlassReads,
    proofs,
    committed,
    selfServe,
  } = createSsoSelfServeFixture({
    context: HOSTED_OPTED_IN,
    members,
    now: () => clock,
  }));

  const registered = await selfServe.registerConnection({
    organizationId: ORG,
    providerId: "okta",
    idp: OIDC_REGISTRATION,
    actor: ANA,
  });
  connectionId = registered.connectionId;
});

const held = () => connections.findConnection({ connectionId });

/** The connection with a proved domain, which is where going live starts. */
async function proveDomain(): Promise<void> {
  await selfServe.claimDomain({
    organizationId: ORG,
    connectionId,
    domain: "acme.com",
    actor: ANA,
  });
  // The published record is what decides the claim on this tier, so the
  // verification is commanded through the ceremony rather than faked into
  // the state — the fold has to produce VERIFIED for activation to be
  // reachable at all.
  const asked = await selfServe.proveDomain({
    organizationId: ORG,
    connectionId,
    domain: "acme.com",
    actor: ANA,
  });
  if (asked.proved) return;
  proofs.published = [asked.record.value];
  await selfServe.checkDomainRecord({
    organizationId: ORG,
    connectionId,
    domain: "acme.com",
    actor: ANA,
  });
}

/** A sign-in that happened, as the account store would answer it. */
function signedInThroughIt(): void {
  testSignIns.record({
    organizationId: ORG,
    connectionId,
    signIn: { accountId: "acct_ana", userId: ANA.userId, atMs: T0 - 60_000 },
  });
}

function wayBackIn({ expiresAtMs = T0 + 30 * DAY } = {}): void {
  breakGlassReads.bindings = [
    bindingFor({ organizationId: ORG, grantedAtMs: T0 - DAY, expiresAtMs }),
  ];
}

/** The fourth precondition: somebody has said who the connection admits. */
async function arrivalsDecided(policy: SsoArrivalPolicy = "admit") {
  await selfServe.setArrivals({
    organizationId: ORG,
    connectionId,
    policy,
    actor: ANA,
  });
}

describe("going live with your own identity provider", () => {
  describe("given what proves the connection carries a person", () => {
    /** @scenario "A sign-in through the connection is what records the test" */
    it("reads the account that sign-in left behind as the test being done", async () => {
      signedInThroughIt();

      const setup = await selfServe.getSetup({ organizationId: ORG });

      expect(setup.goLive?.testSignIn.done).toBe(true);
      expect(setup.goLive?.testSignIn.atMs).toBe(T0 - 60_000);
    });

    /** @scenario "No sign-in through the connection means no test" */
    it("reports the step outstanding when nobody has come back through it", async () => {
      const setup = await selfServe.getSetup({ organizationId: ORG });

      expect(setup.goLive?.testSignIn.done).toBe(false);
      expect(setup.goLive?.testSignIn.atMs).toBeNull();
    });

    /** @scenario "Somebody else's sign-in through another organization's connection is not this test" */
    it("does not count an account recorded against another organization", async () => {
      testSignIns.record({
        organizationId: "org_other",
        connectionId,
        signIn: { accountId: "acct_x", userId: "user_x", atMs: T0 },
      });

      const setup = await selfServe.getSetup({ organizationId: ORG });

      expect(setup.goLive?.testSignIn.done).toBe(false);
    });
  });

  describe("when every precondition is met", () => {
    beforeEach(async () => {
      await proveDomain();
      signedInThroughIt();
      wayBackIn();
      await arrivalsDecided();
    });

    /** @scenario "Going live with all three preconditions met turns the connection on" */
    it("turns the connection on and records the account the sign-in left behind", async () => {
      const { alreadyLive } = await selfServe.activate({
        organizationId: ORG,
        connectionId,
        actor: ANA,
      });

      expect(alreadyLive).toBe(false);
      const state = await held();
      expect(state?.state).toBe("ACTIVE");
      // The id on the fact is the account that EXISTS, not a value the
      // surface chose: the ledger's record of an activation names the
      // sign-in it rests on.
      expect(state?.testLoginAccountId).toBe("acct_ana");
    });

    /** @scenario "The go-live button is offered only once every precondition is met" */
    it("reports the checklist ready", async () => {
      const setup = await selfServe.getSetup({ organizationId: ORG });

      expect(setup.goLive).toMatchObject({
        domainProved: true,
        testSignIn: { done: true },
        breakGlass: { inPlace: true },
        ready: true,
        activated: false,
      });
    });

    /** @scenario "Going live twice costs nothing and states nothing" */
    it("states nothing the second time", async () => {
      await selfServe.activate({
        organizationId: ORG,
        connectionId,
        actor: ANA,
      });
      const after = committed.length;

      const { alreadyLive } = await selfServe.activate({
        organizationId: ORG,
        connectionId,
        actor: ANA,
      });

      expect(alreadyLive).toBe(true);
      expect(committed.length).toBe(after);
    });

    /** @scenario "A connection that is live says sign-in is decided by it" */
    it("says the connection is on, which is what decides sign-in", async () => {
      await selfServe.activate({
        organizationId: ORG,
        connectionId,
        actor: ANA,
      });

      const setup = await selfServe.getSetup({ organizationId: ORG });

      expect(setup.goLive?.activated).toBe(true);
    });
  });

  describe("when a precondition is missing", () => {
    /** @scenario "Going live without a proved domain says so by name" */
    it("refuses an unproved domain by name and states nothing", async () => {
      signedInThroughIt();
      wayBackIn();

      const error = await selfServe
        .activate({ organizationId: ORG, connectionId, actor: ANA })
        .then(refused, (caught: unknown) => caught);

      expect(codeOf(error)).toBe("sso_activation_domain_unproved");
      expect((await held())?.state).not.toBe("ACTIVE");
    });

    /** @scenario "Going live without a test sign-in says so by name" */
    it("refuses a connection nobody has signed in through, by name", async () => {
      await proveDomain();
      wayBackIn();

      const error = await selfServe
        .activate({ organizationId: ORG, connectionId, actor: ANA })
        .then(refused, (caught: unknown) => caught);

      expect(codeOf(error)).toBe("sso_activation_test_sign_in_missing");
      expect((await held())?.state).not.toBe("ACTIVE");
    });

    /** @scenario "Going live without a way back in says so by name" */
    it("refuses an organization with no way back in, by name", async () => {
      await proveDomain();
      signedInThroughIt();

      const error = await selfServe
        .activate({ organizationId: ORG, connectionId, actor: ANA })
        .then(refused, (caught: unknown) => caught);

      expect(codeOf(error)).toBe("sso_activation_break_glass_missing");
      expect((await held())?.state).not.toBe("ACTIVE");
    });

    /** @scenario Saying nothing is not an answer, and going live says so */
    it("refuses a connection nobody has said who it admits, by name", async () => {
      await proveDomain();
      signedInThroughIt();
      wayBackIn();

      const error = await selfServe
        .activate({ organizationId: ORG, connectionId, actor: ANA })
        .then(refused, (caught: unknown) => caught);

      // Registration states `refuse` and the journey never mentioned it, so
      // every connection forbade provisioning and a person signing in through
      // their own organization's provider was handed a workspace of their own.
      // Nobody chose that. Turning it on without deciding is choosing by not
      // choosing, and this is what interrupts it.
      expect(codeOf(error)).toBe("sso_activation_arrivals_undecided");
      expect((await held())?.state).not.toBe("ACTIVE");
    });

    /** @scenario Any of the three answers unblocks it, because the gate is deciding */
    it("lets it through once somebody has said, whichever answer they gave", async () => {
      await proveDomain();
      signedInThroughIt();
      wayBackIn();
      // "Turn everybody away" is a decision too, and the gate is on the
      // deciding rather than on any particular answer.
      await arrivalsDecided("refuse");

      await selfServe.activate({
        organizationId: ORG,
        connectionId,
        actor: ANA,
      });

      expect((await held())?.state).toBe("ACTIVE");
    });

    /** @scenario A connection registered before the question keeps what it did */
    it("is already on an answer before anybody has spoken, and still says nobody chose it", async () => {
      await proveDomain();

      const setup = await selfServe.getSetup({ organizationId: ORG });

      // Registration stated `refuse`, and no policy fact has changed it: the
      // connection has a behaviour, and the journey still says nobody CHOSE
      // it. Those are two different facts and the screen shows both.
      expect(setup.connection?.arrivalPolicy).toBe("refuse");
      expect(setup.goLive?.arrivalsDecided).toBe(false);
    });

    /** @scenario Saying it out loud is a fact even where the behaviour is the same */
    it("records the decision even when it matches what it was already doing", async () => {
      await proveDomain();
      const before = committed.length;

      await arrivalsDecided("refuse");

      // A connection that turns arrivals away because nobody was asked and
      // one that turns them away because an administrator chose to are the
      // same behaviour and very different states.
      expect(committed.length).toBe(before + 1);
      expect(
        (await selfServe.getSetup({ organizationId: ORG })).goLive
          ?.arrivalsDecided,
      ).toBe(true);

      // And restating it now costs nothing, because somebody has said. The
      // guard states no fact and the service never reaches the ledger, so a
      // screen that saves without changing anything writes no history at all.
      const afterDeciding = committed.length;
      await arrivalsDecided("refuse");
      expect(committed.length).toBe(afterDeciding);
    });

    /** @scenario "A way back in that has expired is not one" */
    it("does not count a binding whose end date has passed", async () => {
      await proveDomain();
      signedInThroughIt();
      wayBackIn({ expiresAtMs: T0 - DAY });

      const error = await selfServe
        .activate({ organizationId: ORG, connectionId, actor: ANA })
        .then(refused, (caught: unknown) => caught);

      expect(codeOf(error)).toBe("sso_activation_break_glass_missing");
    });

    /** @scenario "The go-live step shows all three preconditions rather than the first missing one" */
    it("answers all three preconditions at once rather than only the first", async () => {
      const setup = await selfServe.getSetup({ organizationId: ORG });

      expect(setup.goLive).toMatchObject({
        domainProved: false,
        testSignIn: { done: false },
        breakGlass: { inPlace: false, liveCount: 0 },
        ready: false,
      });
    });
  });

  describe("when the organization may not set single sign-on up itself", () => {
    /** @scenario "Going live is refused for an organization that may not set single sign-on up" */
    it("refuses going live for the same reason it refuses everything else", async () => {
      await proveDomain();
      signedInThroughIt();
      wayBackIn();
      context.set(HOSTED_NOT_OPTED_IN);

      const error = await selfServe
        .activate({ organizationId: ORG, connectionId, actor: ANA })
        .then(refused, (caught: unknown) => caught);

      expect(codeOf(error)).toBe("sso_self_serve_unavailable");
    });
  });

  describe("given the ways back in an organization holds", () => {
    /** @scenario "The ways back in are listed with who holds them and until when" */
    it("names the holder, who granted it, and the date it ends", async () => {
      breakGlassReads.bindings = [
        bindingFor({
          organizationId: ORG,
          userId: BEN.userId,
          grantedByUserId: ANA.userId,
          grantedAtMs: T0 - DAY,
          expiresAtMs: T0 + 10 * DAY,
        }),
      ];

      const [binding] = await selfServe.breakGlassHistory({
        organizationId: ORG,
      });

      expect(binding).toMatchObject({
        userId: BEN.userId,
        name: "Ben",
        email: "ben@acme.com",
        grantedByName: "Ana",
        expiresAtMs: T0 + 10 * DAY,
        live: true,
      });
    });

    /** @scenario "A lapsed subscription does not take the way back in away" */
    it("reads the ways back in for an organization that may not set single sign-on up", async () => {
      context.set(HOSTED_NOT_OPTED_IN);
      wayBackIn();

      const bindings = await selfServe.breakGlassHistory({
        organizationId: ORG,
      });

      // Not refused: what gates registration and going live must never gate
      // the recovery path, so this read runs no availability check at all.
      expect(bindings).toHaveLength(1);
    });

    it("offers the organization's administrators as who one can be granted to", async () => {
      const candidates = await selfServe.breakGlassCandidates({
        organizationId: ORG,
      });

      // Each candidate carries whether they could actually walk through a
      // grant, so the picker can say what somebody would have to do first.
      expect(candidates).toEqual([
        {
          userId: ANA.userId,
          name: "Ana",
          email: "ana@acme.com",
          holdsPassword: true,
        },
      ]);
    });
  });
});
