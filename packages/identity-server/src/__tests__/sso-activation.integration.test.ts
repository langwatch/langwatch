import {
  type SsoArrivalPolicy,
  type SsoConnectionCommand,
  type SsoConnectionFactInput,
  type SsoSelfServeContext,
} from "@langwatch/identity";
import { beforeEach, describe, expect, it } from "vitest";
import { SsoConnectionGuards } from "../sso-connection-guards";
import type { SsoConnectionLedger } from "../sso-connection-ledger";
import { SsoConnectionService } from "../sso-connection.service";
import type { SsoCredentialStore } from "../sso-credential-store";
import type { SsoIssuerDiscoveryPort } from "../sso-idp-registration";
import type {
  SsoDomainProofLookup,
  SsoDomainTxtLookup,
  SsoLicenseProofPort,
  SsoSelfServeContextPort,
} from "../sso-self-serve.service";
import { SsoSelfServeService } from "../sso-self-serve.service";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubLicenseAuthority,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections";
import {
  bindingFor,
  StubBreakGlassReads,
  StubMembers,
  StubRouting,
  StubTestSignIns,
} from "./support/in-memory-self-serve";

/**
 * Going live without asking us (wave 3 — see
 * specs/identity/sso-activation.feature).
 *
 * Integration rather than unit because the composition IS the behavior: the
 * refusal a customer reads comes from the self-serve service, and the rule it
 * refuses on is the aggregate's guard. Both run here, through the real
 * connection service and the real fold, so a scenario cannot pass against a
 * checklist that agrees with itself and disagrees with the ledger.
 *
 * Four seams are doubled and nothing above them is: the account store (has
 * anybody signed in), the bindings (can anybody still get in), the directory
 * (who are they), and the rollout flag (has the auth screens moved).
 */

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

class StubContext implements SsoSelfServeContextPort {
  constructor(private context: SsoSelfServeContext) {}

  async resolve(): Promise<SsoSelfServeContext> {
    return this.context;
  }

  set(context: SsoSelfServeContext): void {
    this.context = context;
  }
}

class StubCredentials implements SsoCredentialStore {
  private readonly held = new Map<string, string>();

  async put({
    kind,
    value,
  }: Parameters<SsoCredentialStore["put"]>[0]): Promise<string> {
    const ref = `cred_${kind}_${this.held.size}`;
    this.held.set(ref, value);
    return ref;
  }

  async read({
    ref,
  }: Parameters<SsoCredentialStore["read"]>[0]): Promise<string | null> {
    return this.held.get(ref) ?? null;
  }
}

class StubDiscovery implements SsoIssuerDiscoveryPort {
  async discover(): Promise<{ reachable: true }> {
    return { reachable: true };
  }
}

class StubLicenseProof implements SsoLicenseProofPort {
  async currentLicenseKey(): Promise<string | null> {
    return null;
  }
}

/** The resolver seam. A scenario publishes the value it was just given, which
 *  is what the customer does with their DNS. */
class StubProofs implements SsoDomainProofLookup {
  published: string[] = [];

  async lookupTxtValues(): Promise<SsoDomainTxtLookup> {
    if (this.published.length === 0) return { outcome: "absent" };
    return { outcome: "published", values: this.published };
  }
}

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
let activationBindings: StubBreakGlassBindings;
let routing: StubRouting;
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
  connections = new InMemoryConnections();
  context = new StubContext(HOSTED_OPTED_IN);
  testSignIns = new StubTestSignIns();
  breakGlassReads = new StubBreakGlassReads();
  // The guard asks its OWN break-glass port, which on a real deployment is
  // the same service the surface reads. Held separately here so a scenario
  // can prove the surface refuses first and the guard would have refused
  // anyway.
  activationBindings = new StubBreakGlassBindings(true);
  routing = new StubRouting(false);
  proofs = new StubProofs();
  members = new StubMembers(
    [{ userId: ANA.userId, name: "Ana", email: "ana@acme.com" }],
    [{ userId: BEN.userId, name: "Ben", email: "ben@acme.com" }],
  );
  committed = [];
  clock = T0;

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
  const connectionService = new SsoConnectionService(
    new SsoConnectionGuards({
      connections,
      breakGlass: activationBindings,
      stranding: new StubStranding([]),
      platformOperators: new StubPlatformOperators([]),
      licenseAuthority: new StubLicenseAuthority(false),
    }),
    ledger,
  );
  selfServe = new SsoSelfServeService({
    connections: () => connectionService,
    reads: connections,
    context,
    proofs,
    files: { fetchVerificationFile: async () => ({ outcome: "absent" }) },
    license: new StubLicenseProof(),
    credentials: new StubCredentials(),
    discovery: new StubDiscovery(),
    baseUrl: "https://app.langwatch.test",
    testSignIns,
    breakGlass: breakGlassReads,
    members,
    routing,
    now: () => clock,
  });

  const registered = await selfServe.registerConnection({
    organizationId: ORG,
    providerId: "okta",
    allowsJit: false,
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

    /** @scenario "A connection that is live but not routing says so plainly" */
    it("says the connection is on and that sign-in has not moved to it", async () => {
      await selfServe.activate({
        organizationId: ORG,
        connectionId,
        actor: ANA,
      });

      const setup = await selfServe.getSetup({ organizationId: ORG });

      expect(setup.goLive?.activated).toBe(true);
      expect(setup.goLive?.routingSwitchedOn).toBe(false);
    });

    /** @scenario "A connection that is live and routing says that instead" */
    it("says sign-in is decided by the connection once the rollout reaches the organization", async () => {
      await selfServe.activate({
        organizationId: ORG,
        connectionId,
        actor: ANA,
      });
      routing.set(true);

      const setup = await selfServe.getSetup({ organizationId: ORG });

      expect(setup.goLive?.activated).toBe(true);
      expect(setup.goLive?.routingSwitchedOn).toBe(true);
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

      // `allowsJit` defaulted to false and the journey never mentioned it, so
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

      await selfServe.activate({ organizationId: ORG, connectionId, actor: ANA });

      expect((await held())?.state).toBe("ACTIVE");
    });

    /** @scenario A connection registered before the question keeps what it did */
    it("answers with what allowsJit already said where nobody has spoken", async () => {
      await proveDomain();

      const setup = await selfServe.getSetup({ organizationId: ORG });

      // Registered with `allowsJit: false`, and no policy fact: the answer is
      // the behaviour it already had, and the journey still says nobody chose
      // it. Nothing about a history written before the question replays
      // differently.
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

      expect(candidates).toEqual([
        { userId: ANA.userId, name: "Ana", email: "ana@acme.com" },
      ]);
    });
  });
});
