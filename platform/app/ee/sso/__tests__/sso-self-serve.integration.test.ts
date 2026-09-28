// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  emptySsoConnection,
  SSO_DNS_RECORD_NAME,
  type SsoConnectionCommand,
  type SsoConnectionFactInput,
  type SsoConnectionLifecycleState,
  type SsoSelfServeContext,
} from "@langwatch/identity";
import { sha256Hex } from "@langwatch/identity-server";
import { beforeEach, describe, expect, it } from "vitest";
import type { SsoConnectionService } from "../sso-connection.service";
import type { SsoSelfServeService } from "../sso-self-serve.service";
import type {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubLicenseAuthority,
} from "./support/in-memory-connections";
import {
  createSsoSelfServeFixture,
  type StubContext,
  type StubProofs,
} from "./support/sso-self-serve.fixture";

/** Exercises both onboarding tiers through the real services, guards and fold. */

const ORG = "org_acme";
const OTHER_ORG = "org_first";
/** The connection the journey registered. Set by `register()`. */
let CONNECTION = "ssoc_acme";
const ANA = { userId: "user_ana" };
const OLIVE = { type: "user" as const, id: "user_olive" };
const T0 = 1_756_000_000_000;

const HOSTED_OPTED_IN: SsoSelfServeContext = {
  deployment: "hosted",
  licensed: false,
  licenseActivatedSinceStart: false,
  optedIn: true,
};

const SELF_HOSTED_LICENSED: SsoSelfServeContext = {
  deployment: "self-hosted",
  licensed: true,
  licenseActivatedSinceStart: false,
  optedIn: false,
};

/** What an administrator hands over for an OpenID Connect provider. */
const OIDC_REGISTRATION = {
  protocol: "oidc" as const,
  issuer: "https://login.acme.okta.com",
  clientId: "client_acme",
  clientSecret: "secret_acme",
};

/**
 * A call that was expected to be refused. Written as a two-handed `then`
 * rather than a `catch` so the answer is the refusal alone: a `catch` widens
 * the type to "the refusal or whatever the call returns", and every
 * assertion below then has to be about a union nobody is testing.
 */
const refused = (): never => {
  throw new Error("the call was expected to be refused");
};

let connections: InMemoryConnections;
/** The pre-connection sign-in strings, when this organization still has them. */
let legacySso: { ssoDomain: string; ssoProvider: string } | null;
let breakGlass: StubBreakGlassBindings;
let licenseAuthority: StubLicenseAuthority;
let context: StubContext;
let proofs: StubProofs;
let committed: {
  command: SsoConnectionCommand;
  facts: SsoConnectionFactInput[];
}[];
let clock: number;
let connectionService: SsoConnectionService;
let selfServe: SsoSelfServeService;

beforeEach(() => {
  legacySso = null;
  clock = T0;
  CONNECTION = "ssoc_acme";
  ({
    connections,
    activationBindings: breakGlass,
    licenseAuthority,
    context,
    proofs,
    committed,
    connectionService,
    selfServe,
  } = createSsoSelfServeFixture({
    context: SELF_HOSTED_LICENSED,
    licenseAuthorizesDomainClaims: true,
    platformOperatorIds: [OLIVE.id],
    legacy: { findLegacySso: async () => legacySso },
    now: () => clock,
  }));
});

/** Every command the journey issued, in order. */
const commanded = (): string[] =>
  committed.map((entry) => entry.command.type.replace("lw.identity.", ""));

const held = () => connections.findConnection({ connectionId: CONNECTION });

/**
 * Register the identity provider, whichever tier this is, and pin the
 * minted id so the rest of the test can address one connection by name.
 * The service mints ids; a test that invented one would be testing a
 * connection the service never made.
 */
async function register(): Promise<string> {
  const { connectionId } = await selfServe.registerConnection({
    organizationId: ORG,
    providerId: "okta",
    idp: OIDC_REGISTRATION,
    actor: ANA,
  });
  CONNECTION = connectionId;
  return connectionId;
}

describe("self-serve single sign-on setup", () => {
  describe("given a self-hosted installation holding a genuine licence", () => {
    /** @scenario "A self-hosted administrator sets single sign-on up with nobody else involved" */
    it("uses the licence for entitlement without treating it as domain evidence", async () => {
      await register();
      const { waitsForReview } = await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });

      expect(waitsForReview).toBe(false);
      const state = await held();
      expect(state?.state).toBe("CLAIMED");
      expect(state?.claimedDomains).toEqual(["acme.com"]);
      expect(state?.domainClaims).toEqual([
        expect.objectContaining({
          domain: "acme.com",
          state: "WAITING",
          authority: null,
        }),
      ]);
      expect(commanded()).toEqual(["register_connection", "claim_domain"]);
    });

    /** @scenario "A licensed installation still needs domain-ownership evidence" */
    it("does not qualify an unproven domain merely because the installation serves a licence", async () => {
      await register();
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });

      const outcome = await selfServe.proveDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });

      expect(outcome).toMatchObject({ proved: false });
      const state = await held();
      expect(state?.state).toBe("VERIFICATION_PENDING");
      expect(state?.verifiedDomains).toEqual([]);
      expect(state?.domainVerifications).toEqual([]);
      expect(
        await connections.findDomainOwner({ domain: "acme.com" }),
      ).toBeNull();
      expect(
        committed
          .flatMap((entry) => entry.facts)
          .some((fact) => fact.type === "lw.identity.domain_verified"),
      ).toBe(false);
      expect(proofs.asked).toEqual([]);
    });

    /** @scenario "The proof is recorded as a hash and the identity provider's secret is not recorded at all" */
    /** @scenario "A client secret never reaches the event log" */
    it("records the proof's hash and no secret anywhere in the facts", async () => {
      await register();
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      const issued = await selfServe.proveDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      if (issued.proved) throw new Error("ownership must issue a record");

      const requested = committed
        .flatMap((entry) => entry.facts)
        .find((fact) => fact.type === "lw.identity.verification_requested");
      expect(requested?.data).toMatchObject({
        tokenHash: `sha256:${sha256Hex(issued.record.value)}`,
      });

      // Provider credentials belong in the vault; facts contain only references.
      const history = JSON.stringify(committed);
      expect(history).not.toContain(OIDC_REGISTRATION.clientSecret);
      expect(history).not.toContain(OIDC_REGISTRATION.clientId);
      const registered = committed
        .flatMap((entry) => entry.facts)
        .find((fact) => fact.type === "lw.identity.connection_registered");
      expect(registered?.data).toMatchObject({
        idp: expect.objectContaining({
          secretRef: expect.stringContaining("cred_"),
          clientIdRef: expect.stringContaining("cred_"),
        }),
      });
    });

    /** @scenario "A self-hosted administrator is not offered attestation either" */
    it("offers a published proof and no self-serve attestation", async () => {
      await register();
      const view = await selfServe.getSetup({ organizationId: ORG });

      expect(view.availability).toEqual({
        available: true,
        proof: "dns-txt",
        claimWaitsForReview: false,
      });
      // Vouching for a domain is a LangWatch operator's act on every tier, so
      // there is no value of this surface under which it is offered.
      expect(view.attestationOffered).toBe(false);
      expect(Object.keys(selfServe)).not.toContain("attestDomain");
      expect(
        (selfServe as unknown as Record<string, unknown>).attestDomain,
      ).toBeUndefined();
    });

    /** @scenario "The only connection on an installation still leaves a way in" */
    it("activates only while somebody holds a way in that does not use the identity provider", async () => {
      await register();
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      const issued = await selfServe.proveDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      if (issued.proved) throw new Error("ownership must issue a record");
      proofs.published = [issued.record.value];
      await selfServe.checkDomainRecord({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });

      const activate = (commandId: string) =>
        connectionService.activateConnection({
          tenantId: ORG,
          organizationId: ORG,
          connectionId: CONNECTION,
          commandId,
          occurredAtMs: clock,
          actor: { type: "user", id: ANA.userId },
          source: "self-serve",
          testLoginAccountId: "acc_test",
        });

      breakGlass.set(false);
      await expect(activate("ssocmd_a")).rejects.toMatchObject({
        code: "sso_connection_activation_blocked",
      });

      breakGlass.set(true);
      await activate("ssocmd_b");
      expect((await held())?.state).toBe("ACTIVE");

      // And that way in keeps working after activation: nothing in the
      // journey revoked it, so the same question still answers yes.
      expect(await breakGlass.hasLiveBinding()).toBe(true);
    });
  });

  describe("given a self-hosted installation holding no genuine licence", () => {
    beforeEach(() => {
      context.set({
        deployment: "self-hosted",
        licensed: false,
        licenseActivatedSinceStart: false,
        optedIn: false,
      });
    });

    /** @scenario "An unlicensed self-hosted installation is told what would change that" */
    it("refuses setup by name and names activating a licence, nothing internal", async () => {
      const view = await selfServe.getSetup({ organizationId: ORG });
      expect(view.availability).toEqual({
        available: false,
        refusal: "license_required",
      });

      const refusal = await selfServe
        .registerConnection({
          organizationId: ORG,
          providerId: "okta",
          idp: OIDC_REGISTRATION,
          actor: ANA,
        })
        .then(
          refused,
          (error: unknown) => error as { code: string; message: string },
        );

      expect(refusal.code).toBe("sso_license_required");
      // The wire message IS the code; the words a reader sees come from the
      // client registry, which the app's own suite pins. What is asserted
      // here is that nothing was commanded and nothing internal is named.
      expect(committed).toEqual([]);
      expect(refusal.message).not.toMatch(
        /env|environment|localhost|postgres|prisma|http:\/\//i,
      );
    });

    /** @scenario "A licence activated while the installation is running takes effect at the next restart" */
    it("stays unavailable after a licence is activated, and says a restart is needed", async () => {
      context.set({
        deployment: "self-hosted",
        licensed: false,
        // Genuine, and activated after this process decided what it
        // federates — which is the whole of why the answer is "restart".
        licenseActivatedSinceStart: true,
        optedIn: false,
      });

      const view = await selfServe.getSetup({ organizationId: ORG });
      expect(view.availability).toEqual({
        available: false,
        refusal: "license_restart_required",
      });
      // And it does not pretend otherwise: the refusal is distinct from the
      // never-licensed one, so the screen can say "restart" rather than
      // "activate a licence" to somebody who just did.
      await expect(
        selfServe.claimDomain({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: "acme.com",
          actor: ANA,
        }),
      ).rejects.toMatchObject({ code: "sso_license_required" });
      expect(committed).toEqual([]);
    });
  });

  describe("given a hosted organization opted in to setting up itself", () => {
    beforeEach(() => {
      context.set(HOSTED_OPTED_IN);
      // A hosted deployment holds no instance licence to speak for it, so
      // the licence can authorize nothing here.
      licenseAuthority.set(false);
    });

    /** @scenario "A hosted administrator claims a domain and is given the record straight away" */
    it("claims the domain and issues the record with nothing waiting on LangWatch", async () => {
      await register();
      const claimed = await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });

      expect(claimed).toEqual({ waitsForReview: false, disputed: false });
      const state = await held();
      // The claim is WAITING because nothing has decided it yet, and what
      // will decide it is the record — not a person. Nobody was commanded to
      // approve anything.
      expect(state?.state).toBe("CLAIMED");
      expect(state?.domainClaims).toEqual([
        expect.objectContaining({
          domain: "acme.com",
          state: "WAITING",
          claimedAtMs: T0,
          decidedAtMs: null,
          authority: null,
        }),
      ]);
      // Nothing about the domain routes yet: only a VERIFIED domain on an
      // ACTIVE connection ever does, and it is neither.
      expect(state?.verifiedDomains).toEqual([]);
      expect(
        await connections.findDomainOwner({ domain: "acme.com" }),
      ).toBeNull();

      // And the record is hers immediately, off an undecided claim.
      const issued = await selfServe.proveDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      if (issued.proved) throw new Error("hosted setup must issue a record");
      expect(issued.record.label).toBe(SSO_DNS_RECORD_NAME);
      expect(commanded()).toEqual([
        "register_connection",
        "claim_domain",
        "request_verification",
      ]);
    });

    /** @scenario "A published record decides the claim, with nobody at LangWatch in the loop" */
    it("approves the claim on the record's authority and proves the domain in one act", async () => {
      await register();
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      const issued = await selfServe.proveDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      if (issued.proved) throw new Error("hosted setup must issue a record");

      proofs.published = [issued.record.value];
      await selfServe.checkDomainRecord({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });

      const state = await held();
      expect(state?.state).toBe("VERIFIED");
      expect(state?.verifiedDomains).toEqual(["acme.com"]);
      expect(state?.domainClaims).toEqual([
        expect.objectContaining({
          domain: "acme.com",
          state: "APPROVED",
          authority: "dns-proof",
        }),
      ]);
      // The approval and the proof are one commit, in that order, so no
      // reading of the history has a domain approved before anything proved
      // it — and no operator command appears anywhere in it.
      expect(statesFrom(CONNECTION)).toEqual([
        "connection_registered",
        "domain_claimed",
        "verification_requested",
        "domain_claim_approved",
        "domain_verified",
      ]);
      expect(commanded()).not.toContain("approve_domain_claim");
      expect(commanded()).not.toContain("attest_domain");
      expect(
        committed
          .flatMap((entry) => entry.facts)
          .map((fact) => fact.data.actor),
      ).not.toContainEqual(OLIVE);
    });

    /** @scenario "The approval is stated after the proof, never before it" */
    it("records the claim and the record it asked for, and no approval until one lands", async () => {
      await register();
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      await selfServe.proveDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });

      expect(statesFrom(CONNECTION)).toEqual([
        "connection_registered",
        "domain_claimed",
        "verification_requested",
      ]);
      const state = await held();
      expect(state?.approvedDomains).toEqual([]);
      expect(state?.domainClaims[0]?.authority).toBeNull();
    });

    /** @scenario "A claim on a domain another organization proved waits for a person" */
    /** @scenario "A disputed claim is the one that cannot be proved yet" */
    it("leaves a contested claim waiting and refuses the record until somebody decides", async () => {
      seedOtherOrganizationOn("acme.com");
      await register();

      const claimed = await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      expect(claimed).toEqual({ waitsForReview: true, disputed: true });
      expect((await held())?.domainClaims).toEqual([
        expect.objectContaining({ domain: "acme.com", state: "WAITING" }),
      ]);

      const refusal = await selfServe
        .proveDomain({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: "acme.com",
          actor: ANA,
        })
        .then(
          refused,
          (error: unknown) => error as { code: string; message: string },
        );

      expect(refusal.code).toBe("sso_domain_claim_pending");
      // Nothing about who is looking or who holds the domain: not a name,
      // not a queue, not the other organization.
      expect(refusal.message).not.toMatch(/olive|operator|reviewer|queue/i);
      expect(refusal.message).not.toContain(OTHER_ORG);
      expect(commanded()).not.toContain("request_verification");
    });

    /** @scenario "An operator still decides a disputed claim, either way" */
    it("lets an operator reject a contested claim with a note, and the domain is claimable again", async () => {
      seedOtherOrganizationOn("acme.com");
      await register();
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });

      await connectionService.rejectDomainClaim({
        tenantId: ORG,
        organizationId: ORG,
        connectionId: CONNECTION,
        commandId: "ssocmd_reject_dispute",
        occurredAtMs: T0 + 1_000,
        actor: OLIVE,
        source: "self-serve",
        domain: "acme.com",
        note: "that domain belongs to somebody else",
      });

      const decided = (await held())?.domainClaims[0];
      expect(decided).toMatchObject({
        state: "REJECTED",
        authority: "platform-operator",
        decidedByActorId: OLIVE.id,
        note: "that domain belongs to somebody else",
      });

      // And a rejection is not terminal: the same connection may claim it
      // again, which is what makes a wrong decision recoverable.
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      expect((await held())?.state).toBe("CLAIMED");
    });

    /** @scenario "A consumer mail domain cannot be claimed on any tier" */
    /** @scenario "A public suffix with no company behind it cannot be claimed either" */
    it("refuses a shared mail provider and a bare domain ending, recording nothing", async () => {
      await register();

      for (const domain of ["gmail.com", "com", "co.uk"]) {
        const refusal = await selfServe
          .claimDomain({
            organizationId: ORG,
            connectionId: CONNECTION,
            domain,
            actor: ANA,
          })
          .then(
            refused,
            (error: unknown) => error as { code: string; message: string },
          );
        expect(refusal.code).toBe("sso_domain_not_eligible");
      }

      expect(commanded()).toEqual(["register_connection"]);
      expect((await held())?.domainClaims).toEqual([]);
    });

    /** @scenario "Claiming domain after domain is stopped by name" */
    it("stops the sixth claim in the window by name and says how long is left", async () => {
      await register();
      // Five domains claimed and proved inside the hour, which is the only
      // way five claims can exist: a connection holds one undecided claim at
      // a time, so adding a domain means finishing the one before it.
      for (const domain of [
        "one.example",
        "two.example",
        "three.example",
        "four.example",
        "five.example",
      ]) {
        await claimAndProve(domain);
      }

      clock = T0 + 10 * 60 * 1000;
      const refusal = await selfServe
        .claimDomain({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: "six.example",
          actor: ANA,
        })
        .then(
          refused,
          (error: unknown) =>
            error as { code: string; meta: { retryAfterSeconds: number } },
        );

      expect(refusal.code).toBe("sso_domain_claim_throttled");
      // Fifty minutes of the hour left, counted from the oldest claim still
      // inside the window rather than guessed.
      expect(refusal.meta.retryAfterSeconds).toBe(50 * 60);
      // The five she already has are untouched: a refusal states no fact.
      const state = await held();
      expect(state?.verifiedDomains).toHaveLength(5);
      expect(state?.domainClaims.map((claim) => claim.domain)).not.toContain(
        "six.example",
      );
    });

    /** @scenario "A rejected claim says why, and the domain can be claimed again" */
    it("reads the reviewer's note back and re-claims without a second connection", async () => {
      await register();
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      await connectionService.rejectDomainClaim({
        tenantId: ORG,
        organizationId: ORG,
        connectionId: CONNECTION,
        commandId: "ssocmd_reject",
        occurredAtMs: T0 + 1_000,
        actor: OLIVE,
        source: "self-serve",
        domain: "acme.com",
        note: "we could not reach anybody at that domain",
      });

      const view = await selfServe.getSetup({ organizationId: ORG });
      expect(view.claims).toEqual([
        expect.objectContaining({
          domain: "acme.com",
          state: "REJECTED",
          note: "we could not reach anybody at that domain",
        }),
      ]);

      // Claiming again is available on the SAME connection: no second
      // registration, and the connection id does not change.
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      const state = await held();
      expect(state?.state).toBe("CLAIMED");
      expect(
        commanded().filter((type) => type === "register_connection"),
      ).toHaveLength(1);
    });

    /** @scenario "A published record proves the domain, and a missing one says exactly that" */
    it("refuses a missing record by name, leaves the record unchanged, and proves it once published", async () => {
      await register();
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      await approveByOperator("acme.com");

      const issued = await selfServe.proveDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      if (issued.proved) throw new Error("hosted setup must issue a record");
      expect(issued.record.label).toBe(SSO_DNS_RECORD_NAME);

      // Nothing published yet.
      const refusal = await selfServe
        .checkDomainRecord({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: "acme.com",
          actor: ANA,
        })
        .then(refused, (error: unknown) => error as { code: string });
      expect(refusal).toMatchObject({ code: "sso_domain_proof_not_found" });

      // The record on screen is untouched: same value, same hash, same
      // ceremony — asking and being told no costs nothing.
      const stillPending = (await held())?.pendingVerification;
      expect(stillPending).toMatchObject({
        domain: "acme.com",
        method: "dns-txt",
        tokenHash: `sha256:${sha256Hex(issued.record.value)}`,
      });

      proofs.published = [issued.record.value];
      await selfServe.checkDomainRecord({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      const state = await held();
      expect(state?.state).toBe("VERIFIED");
      expect(state?.domainVerifications).toEqual([
        expect.objectContaining({ domain: "acme.com", method: "dns-txt" }),
      ]);
    });

    /** @scenario "An expired proof verifies nothing and a fresh one costs no progress" */
    it("proves nothing once expired, and issues a fresh record against the same approval", async () => {
      await register();
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      await approveByOperator("acme.com");
      const issued = await selfServe.proveDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      if (issued.proved) throw new Error("hosted setup must issue a record");

      // The record IS published — and it has passed its expiry.
      proofs.published = [issued.record.value];
      clock = issued.record.expiresAtMs + 1;
      await expect(
        selfServe.checkDomainRecord({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: "acme.com",
          actor: ANA,
        }),
      ).rejects.toMatchObject({ code: "sso_domain_proof_expired" });
      expect((await held())?.verifiedDomains).toEqual([]);

      // Asking again costs no progress: a fresh record, the same approved
      // claim, and no second trip through the queue.
      const fresh = await selfServe.proveDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      if (fresh.proved) throw new Error("a fresh record must be issued");
      expect(fresh.record.value).not.toBe(issued.record.value);
      const state = await held();
      expect(state?.approvedDomains).toEqual(["acme.com"]);
      expect(state?.domainClaims).toEqual([
        expect.objectContaining({ domain: "acme.com", state: "APPROVED" }),
      ]);
      expect(
        commanded().filter((type) => type === "claim_domain"),
      ).toHaveLength(1);
    });

    /** @scenario "A customer proving their own domain is the whole point of this tier" */
    it("offers publishing the record and no way around it", async () => {
      await register();
      const view = await selfServe.getSetup({ organizationId: ORG });

      expect(view.availability).toEqual({
        available: true,
        proof: "dns-txt",
        claimWaitsForReview: false,
      });
      expect(view.attestationOffered).toBe(false);

      // And the guard says the same thing to somebody who found the command
      // another way: attesting is a LangWatch operator's act, whoever asks.
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      await approveByOperator("acme.com");
      await expect(
        connectionService.attestDomain({
          tenantId: ORG,
          organizationId: ORG,
          connectionId: CONNECTION,
          commandId: "ssocmd_attest",
          occurredAtMs: clock,
          actor: { type: "user", id: ANA.userId },
          source: "self-serve",
          domain: "acme.com",
          evidenceRef: "support-case:SSO-42",
          note: "Verified the customer-controlled registry record.",
        }),
      ).rejects.toMatchObject({ code: "sso_connection_operator_act_required" });
    });

    /** @scenario "A domain another live connection already holds is refused without naming who holds it" */
    it("refuses a taken domain by name and names neither the other organization nor anybody in it", async () => {
      seedOtherOrganizationOn("acme.com");

      await register();
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      await approveByOperator("acme.com");

      const refusal = await selfServe
        .proveDomain({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: "acme.com",
          actor: ANA,
        })
        .then(
          refused,
          (error: unknown) => error as { code: string; message: string },
        );

      expect(refusal.code).toBe("sso_connection_domain_taken");
      // The refusal names neither the other organization nor anybody in it.
      expect(refusal.message).not.toContain(OTHER_ORG);
      expect(refusal.message).not.toContain("user_first");
      expect(refusal.message).not.toContain("ssoc_first");
    });

    /** @scenario "The licence-bound path is not offered to a hosted organization" */
    it("offers the published record rather than the licence, and refuses the licence path outright", async () => {
      await register();
      const view = await selfServe.getSetup({ organizationId: ORG });
      expect(view.availability).toMatchObject({ proof: "dns-txt" });

      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      await approveByOperator("acme.com");

      // And the guard refuses it to a caller that names the method directly:
      // a hosted deployment holds no instance licence to speak for it.
      await expect(
        connectionService.requestVerification({
          tenantId: ORG,
          organizationId: ORG,
          connectionId: CONNECTION,
          commandId: "ssocmd_licence",
          occurredAtMs: clock,
          actor: { type: "user", id: ANA.userId },
          source: "self-serve",
          domain: "acme.com",
          method: "license-token",
          tokenHash: "sha256:whatever",
        }),
      ).rejects.toMatchObject({ code: "sso_domain_proof_not_found" });
    });
  });

  describe("given a hosted organization that has not been opted in", () => {
    beforeEach(() => {
      context.set({ ...HOSTED_OPTED_IN, optedIn: false });
    });

    /** @scenario "Setting single sign-on up yourself is unavailable until the organization is opted in" */
    it("refuses setup by name and names no flag", async () => {
      const view = await selfServe.getSetup({ organizationId: ORG });
      expect(view.availability).toEqual({
        available: false,
        refusal: "not_opted_in",
      });

      const refusal = await selfServe
        .registerConnection({
          organizationId: ORG,
          providerId: "okta",
          idp: OIDC_REGISTRATION,
          actor: ANA,
        })
        .then(
          refused,
          (error: unknown) => error as { code: string; message: string },
        );

      expect(refusal.code).toBe("sso_self_serve_unavailable");
      // Names no flag: a customer cannot act on one, and printing it turns a
      // rollback lever into something support has to explain away.
      expect(refusal.message).not.toMatch(/flag|SELF_SERVE_SSO/i);
      expect(committed).toEqual([]);
    });
  });

  describe("given a connection created from the configuration it already had", () => {
    it("converges concurrent and retried migration starts on one durable replacement", async () => {
      context.set(HOSTED_OPTED_IN);
      const legacyConnectionId = "ssoc_legacy_acme";
      connections.seed({
        ...emptySsoConnection({ connectionId: legacyConnectionId }),
        organizationId: ORG,
        state: "ACTIVE",
        source: "legacy-grandfathered",
        arrivalPolicy: "admit",
        createdAtMs: T0,
        updatedAtMs: T0,
      });

      const start = () =>
        selfServe.startLegacyMigration({
          organizationId: ORG,
          legacyConnectionId,
          providerId: "okta",
          idp: OIDC_REGISTRATION,
          actor: ANA,
        });

      const [first, concurrent] = await Promise.all([start(), start()]);
      const retry = await start();

      expect(first.connectionId).toBe(concurrent.connectionId);
      expect(retry.connectionId).toBe(first.connectionId);
      expect(
        committed.filter(
          ({ command }) =>
            command.type === "lw.identity.register_replacement_connection",
        ),
      ).toHaveLength(1);
      await expect(
        connections.findConnection({ connectionId: first.connectionId }),
      ).resolves.toMatchObject({
        organizationId: ORG,
        replacesConnectionId: legacyConnectionId,
        migrationPhase: "SETUP",
      });
    });

    it("converges on a new attempt after the previous replacement was discarded", async () => {
      context.set(HOSTED_OPTED_IN);
      const legacyConnectionId = "ssoc_legacy_retry";
      connections.seed({
        ...emptySsoConnection({ connectionId: legacyConnectionId }),
        organizationId: ORG,
        state: "ACTIVE",
        source: "legacy-grandfathered",
        arrivalPolicy: "admit",
        createdAtMs: T0,
        updatedAtMs: T0,
      });
      const start = () =>
        selfServe.startLegacyMigration({
          organizationId: ORG,
          legacyConnectionId,
          providerId: "okta",
          idp: OIDC_REGISTRATION,
          actor: ANA,
        });

      const first = await start();
      clock += 1;
      await selfServe.discardConnection({
        organizationId: ORG,
        connectionId: first.connectionId,
        actor: ANA,
      });
      const [retry, concurrentRetry] = await Promise.all([start(), start()]);

      expect(retry.connectionId).toBe(concurrentRetry.connectionId);
      expect(retry.connectionId).not.toBe(first.connectionId);
      expect(
        committed.filter(
          ({ command }) =>
            command.type === "lw.identity.register_replacement_connection",
        ),
      ).toHaveLength(2);
      await expect(
        connections.findConnection({ connectionId: retry.connectionId }),
      ).resolves.toMatchObject({
        organizationId: ORG,
        replacesConnectionId: legacyConnectionId,
        migrationPhase: "SETUP",
      });
    });

    /** @scenario "A connection carried over from an earlier configuration keeps routing" */
    it("keeps routing sign-ins unchanged while only a new registration meets the refusal", async () => {
      context.set(HOSTED_OPTED_IN);
      // What the grandfather migration states for an organization whose
      // sign-in was configured before connections existed — including a
      // protocol nobody may register through a self-serve surface today.
      await connectionService.grandfatherConnection({
        tenantId: OTHER_ORG,
        organizationId: OTHER_ORG,
        connectionId: "ssoc_carried",
        commandId: "grandfather:org_first",
        occurredAtMs: T0,
        actor: { type: "system", id: null },
        source: "legacy-grandfathered",
        type: "saml",
        idp: {
          issuer: null,
          providerId: "okta",
          clientIdRef: null,
          secretRef: null,
          certRefs: [],
        },
        arrivalPolicy: "admit",
        domains: ["carried.example"],
      });

      const carried = await connections.findConnection({
        connectionId: "ssoc_carried",
      });
      // Nothing about their existing sign-in changes: the connection is live
      // and the one-time migration records the exact configured domain as an
      // imported legacy attestation. No later domain inherits that evidence.
      expect(carried?.state).toBe("ACTIVE");
      expect(carried?.type).toBe("saml");
      expect(carried?.verifiedDomains).toEqual(["carried.example"]);
      expect(carried?.domainVerifications).toEqual([
        expect.objectContaining({
          method: "legacy-configuration",
          legacyImport: expect.objectContaining({
            organizationId: OTHER_ORG,
            predecessorConnectionId: "ssoc_carried",
            domain: "carried.example",
          }),
        }),
      ]);
      expect(
        await connections.findDomainOwner({ domain: "carried.example" }),
      ).toEqual({
        connectionId: "ssoc_carried",
        organizationId: OTHER_ORG,
      });

      // And a NEWLY registered SAML connection is no longer refused for
      // being SAML (D09) — what it is refused for is arriving without the
      // things it takes to dial an identity provider.
      await expect(
        selfServe.registerConnection({
          organizationId: ORG,
          providerId: "okta",
          idp: {
            protocol: "saml",
            entryPoint: "https://login.acme.example/sso",
            entityId: null,
            metadataXml: null,
            certificate: null,
          },
          actor: ANA,
        }),
      ).rejects.toMatchObject({ code: "sso_credentials_required" });

      // The carried connection is exactly as it was: the refusal touched
      // nothing, because a refusal states no fact.
      expect(
        await connections.findConnection({ connectionId: "ssoc_carried" }),
      ).toEqual(carried);
    });
  });

  describe("given connections that reached live traffic through different tiers", () => {
    /** @scenario "Every tier drives one connection through one lifecycle" */
    it("records the same states in the same order however the domain was authorized", async () => {
      // Both deployments use the same ownership ceremony; the licence only
      // authorizes the feature on self-hosted installations.
      await register();
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      const licensedIssued = await selfServe.proveDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      if (licensedIssued.proved) {
        throw new Error("ownership must issue a record");
      }
      proofs.published = [licensedIssued.record.value];
      await selfServe.checkDomainRecord({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      });
      const licensedStates = statesFrom(CONNECTION);

      // Hosted: the published record decides and proves the claim too.
      ({
        connections,
        activationBindings: breakGlass,
        licenseAuthority,
        context,
        proofs,
        committed,
        connectionService,
        selfServe,
      } = createSsoSelfServeFixture({
        context: HOSTED_OPTED_IN,
        platformOperatorIds: [OLIVE.id],
        now: () => clock,
      }));
      await register();
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "beta.example",
        actor: ANA,
      });
      const issued = await selfServe.proveDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "beta.example",
        actor: ANA,
      });
      if (issued.proved) throw new Error("hosted setup must issue a record");
      proofs.published = [issued.record.value];
      await selfServe.checkDomainRecord({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "beta.example",
        actor: ANA,
      });
      const reviewedStates = statesFrom(CONNECTION);

      // The same states, in the same order. What differs is which fact
      // authorized the approval and which method proved the domain — never
      // which states a connection may be in or how it got between them.
      expect(reviewedStates).toEqual(licensedStates);
      expect(reviewedStates).toEqual([
        "connection_registered",
        "domain_claimed",
        "verification_requested",
        "domain_claim_approved",
        "domain_verified",
      ]);
    });
  });
});

/** The fact types one connection's history recorded, in order. */
function statesFrom(connectionId: string): string[] {
  return committed
    .filter((entry) => entry.command.data.connectionId === connectionId)
    .flatMap((entry) => entry.facts)
    .map((fact) => fact.type.replace("lw.identity.", ""));
}

/** One whole zero-touch journey for a domain: claim it, take the record,
 *  publish it, and let the check decide the claim. */
async function claimAndProve(domain: string): Promise<void> {
  await selfServe.claimDomain({
    organizationId: ORG,
    connectionId: CONNECTION,
    domain,
    actor: ANA,
  });
  const issued = await selfServe.proveDomain({
    organizationId: ORG,
    connectionId: CONNECTION,
    domain,
    actor: ANA,
  });
  if (issued.proved) throw new Error("hosted setup must issue a record");
  proofs.published = [issued.record.value];
  await selfServe.checkDomainRecord({
    organizationId: ORG,
    connectionId: CONNECTION,
    domain,
    actor: ANA,
  });
}

describe("removing a connection from the setup page", () => {
  /** @scenario "An administrator removes their own connection that never went live" */
  it("discards a registration that never went live, and the journey starts over", async () => {
    await register();

    await selfServe.discardConnection({
      organizationId: ORG,
      connectionId: CONNECTION,
      actor: ANA,
    });

    expect((await held())?.state).toBe("DISCARDED");
    // The journey re-opens on the register step: the discarded connection is
    // no longer what the setup page renders.
    const setup = await selfServe.getSetup({ organizationId: ORG });
    expect(setup.connection).toBeNull();
  });

  /** @scenario "An administrator removes their own live connection on teardown's terms" */
  it("schedules a live connection's removal with teardown's grace, and answers another organization as if it did not exist", async () => {
    const graceMs = 7 * 24 * 60 * 60 * 1000;
    // Routing stops when removal is requested; final cleanup follows its delay.
    seedOwnActiveConnection();

    await selfServe.removeConnection({
      organizationId: ORG,
      connectionId: CONNECTION,
      actor: ANA,
      reason: null,
      graceMs,
    });

    // Routing has stopped; final cleanup is still scheduled.
    const scheduled = await held();
    expect(scheduled?.state).toBe("TEARDOWN_PENDING");
    expect(scheduled?.tearDownAfterMs).toBe(clock + graceMs);

    await selfServe
      .removeConnection({
        organizationId: OTHER_ORG,
        connectionId: CONNECTION,
        actor: ANA,
        reason: null,
        graceMs,
      })
      .then(refused, (error) =>
        expect((error as { code: string }).code).toBe(
          "sso_connection_not_found",
        ),
      );
  });

  /** @scenario "A removal of a connection that is carrying nobody is scheduled for now" */
  it("schedules a removal of a connection that carries nobody for the moment of the ask", async () => {
    // Paused, so sign-in through it is already off and nobody is being sent
    // to it. The week would protect nobody.
    seedOwnActiveConnection({ state: "SUSPENDED" });

    await selfServe.removeConnection({
      organizationId: ORG,
      connectionId: CONNECTION,
      actor: ANA,
      reason: null,
      graceMs: 7 * 24 * 60 * 60 * 1000,
    });

    const scheduled = await held();
    expect(scheduled?.state).toBe("TEARDOWN_PENDING");
    expect(scheduled?.tearDownAfterMs).toBe(clock);
  });
});

describe("taking a domain back out", () => {
  /** @scenario "A domain is taken back out of the connection" */
  it("removes the domain wherever it stood, and the state falls back to what remains", async () => {
    await register();
    await selfServe.claimDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: "acme.com",
      actor: ANA,
    });

    await selfServe.removeDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: "acme.com",
      actor: ANA,
    });

    const state = await held();
    expect(state?.claimedDomains).toEqual([]);
    expect(state?.approvedDomains).toEqual([]);
    expect(state?.verifiedDomains).toEqual([]);
    // The claim row stays as a TOMBSTONE, and only as one: the domain is gone
    // from every list above, and what the row is still good for is the rate
    // limit, which counts claims inside the window. Deleting it put the
    // budget back, so "five an hour" cost two requests per probe — and what
    // that budget stands in front of is walking a list of other customers'
    // domains to find out which are taken.
    expect(state?.domainClaims.map((claim) => claim.state)).toEqual([
      "WITHDRAWN",
    ]);
    // Nothing else was in flight, so the journey is back at the start.
    expect(state?.state).toBe("DRAFT");
    // The history keeps every step: the claim and the withdrawal are both
    // facts, and neither erased the other.
    expect(commanded()).toContain("withdraw_domain");
  });

  it("does not hand the claim budget back", async () => {
    // WITHDRAWING IS NOT A REFUND. The throttle counts claims inside the
    // window, so deleting the row on withdrawal made the limit cost two
    // requests per probe instead of one — and an unbounded probe is exactly
    // what it stands in front of, because each claim answers whether another
    // customer already holds the domain.
    await register();
    const spent: string[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const domain = `probe-${attempt}.test`;
      await selfServe.claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain,
        actor: ANA,
      });
      await selfServe.removeDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain,
        actor: ANA,
      });
      spent.push(domain);
    }
    expect(spent).toHaveLength(5);

    const refusal = await selfServe
      .claimDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "one-too-many.test",
        actor: ANA,
      })
      .then(
        () => {
          throw new Error("the sixth claim was expected to be throttled");
        },
        (error: { code: string }) => error,
      );

    expect(refusal.code).toBe("sso_domain_claim_throttled");
  });

  /** @scenario "A verified domain cannot be removed from a connection that decides sign-in" */
  it("refuses to pull a verified domain out from under a live connection", async () => {
    seedOwnActiveConnection({ verifiedDomains: ["acme.com"] });

    await selfServe
      .removeDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: ANA,
      })
      .then(refused, (error) =>
        expect((error as { code: string }).code).toBe(
          "sso_connection_invalid_transition",
        ),
      );
    expect((await held())?.verifiedDomains).toEqual(["acme.com"]);
  });
});

/** This organization's own connection, already ACTIVE — seeded rather than
 *  walked through activation, because these tests are about leaving. */
function seedOwnActiveConnection({
  verifiedDomains = [],
  state = "ACTIVE",
}: {
  verifiedDomains?: string[];
  state?: SsoConnectionLifecycleState;
} = {}): void {
  connections.seed({
    connectionId: CONNECTION,
    organizationId: ORG,
    type: "oidc",
    state,
    claimedDomains: [],
    domainClaims: [],
    approvedDomains: [],
    verifiedDomains,
    domainVerifications: [],
    pendingVerification: null,
    idpMetadata: {
      issuer: null,
      providerId: "okta",
      clientIdRef: null,
      secretRef: null,
      certRefs: [],
    },
    arrivalPolicy: "refuse",
    arrivalPolicyDecidedAtMs: null,
    source: "self-serve",
    testLoginAccountId: "acc_acme",
    rejection: null,
    createdBy: ANA.userId,
    createdAtMs: T0,
    updatedAtMs: T0,
    tearDownAfterMs: null,
    replacesConnectionId: null,
    migrationPhase: null,
    graceStartedAtMs: null,
    routeChangedAtMs: null,
    finalizationRequestedAtMs: null,
    finalizedAtMs: null,
  });
}

/** Another organization's connection, already live on a domain. What makes a
 *  claim on that domain a dispute rather than something a record settles. */
function seedOtherOrganizationOn(domain: string): void {
  connections.seed({
    connectionId: "ssoc_first",
    organizationId: OTHER_ORG,
    type: "oidc",
    state: "ACTIVE",
    claimedDomains: [],
    domainClaims: [],
    approvedDomains: [],
    verifiedDomains: [domain],
    domainVerifications: [
      {
        domain,
        method: "dns-txt",
        actorId: "user_first",
        verifiedAtMs: T0,
        proofState: "VERIFIED",
        firstAbsentAtMs: null,
        graceEndsAtMs: null,
        tokenHash: "sha256:first-proof",
      },
    ],
    pendingVerification: null,
    idpMetadata: {
      issuer: null,
      providerId: "okta",
      clientIdRef: null,
      secretRef: null,
      certRefs: [],
    },
    arrivalPolicy: "refuse",
    arrivalPolicyDecidedAtMs: null,
    source: "self-serve",
    testLoginAccountId: "acc_first",
    rejection: null,
    createdBy: "user_first",
    createdAtMs: T0,
    updatedAtMs: T0,
    tearDownAfterMs: null,
    replacesConnectionId: null,
    migrationPhase: null,
    graceStartedAtMs: null,
    routeChangedAtMs: null,
    finalizationRequestedAtMs: null,
    finalizedAtMs: null,
  });
}

/** The queue's decision, as a LangWatch operator makes it. */
async function approveByOperator(domain: string): Promise<void> {
  await connectionService.approveDomainClaim({
    tenantId: ORG,
    organizationId: ORG,
    connectionId: CONNECTION,
    commandId: `ssocmd_approve_${domain}`,
    occurredAtMs: clock,
    actor: OLIVE,
    source: "self-serve",
    domain,
  });
}

/** Foreign and missing connections must give the same refusal on every surface. */
describe("given a connection that belongs to another organization", () => {
  beforeEach(() => {
    seedOwnActiveConnection({ verifiedDomains: ["acme.com"] });
    context.set(HOSTED_OPTED_IN);
  });

  describe("when an administrator of a different organization names it", () => {
    it("refuses to claim a domain onto it", async () => {
      await expect(
        selfServe.claimDomain({
          organizationId: OTHER_ORG,
          connectionId: CONNECTION,
          domain: "evil.test",
          actor: ANA,
        }),
      ).rejects.toMatchObject({ code: "sso_connection_not_found" });
    });

    it("refuses to mint a proof on it", async () => {
      await expect(
        selfServe.proveDomain({
          organizationId: OTHER_ORG,
          connectionId: CONNECTION,
          domain: "acme.com",
          actor: ANA,
        }),
      ).rejects.toMatchObject({ code: "sso_connection_not_found" });
    });

    it("refuses to drive its record check", async () => {
      await expect(
        selfServe.checkDomainRecord({
          organizationId: OTHER_ORG,
          connectionId: CONNECTION,
          domain: "acme.com",
          actor: ANA,
        }),
      ).rejects.toMatchObject({ code: "sso_connection_not_found" });
    });

    it("refuses to drive its file check", async () => {
      await expect(
        selfServe.checkDomainFile({
          organizationId: OTHER_ORG,
          connectionId: CONNECTION,
          domain: "acme.com",
          actor: ANA,
        }),
      ).rejects.toMatchObject({ code: "sso_connection_not_found" });
    });

    it("answers the same refusal a connection that does not exist answers", async () => {
      const foreign = await selfServe
        .claimDomain({
          organizationId: OTHER_ORG,
          connectionId: CONNECTION,
          domain: "evil.test",
          actor: ANA,
        })
        .then(refused, (error) => error as Error);
      const missing = await selfServe
        .claimDomain({
          organizationId: OTHER_ORG,
          connectionId: "ssoc_nothing_here",
          domain: "evil.test",
          actor: ANA,
        })
        .then(refused, (error) => error as Error);

      // Not an existence oracle: connection ids are not secret, so "not
      // yours" and "not there" have to be one sentence.
      expect(foreign.message).toBe(
        missing.message.replace("ssoc_nothing_here", CONNECTION),
      );
      expect((foreign as unknown as { code: string }).code).toBe(
        (missing as unknown as { code: string }).code,
      );
    });
  });
});

describe("given an organization still on a pre-connection sign-in route", () => {
  describe("when the setup screen reads it", () => {
    /** @scenario "An organization already routing sign-in is not offered a second connection" */
    it("reports the route it is on, rather than leaving the screen to offer a rival", async () => {
      legacySso = { ssoDomain: "acme.test", ssoProvider: "auth0" };

      const view = await selfServe.getSetup({ organizationId: ORG });

      // No connection has been recorded yet, which is exactly the state the
      // screen used to read as "nothing is set up here".
      expect(view.connection).toBeNull();
      expect(view.legacyRoute).toEqual({
        domain: "acme.test",
        provider: "auth0",
      });
    });
  });
});

describe("given an organization that has never set sign-in up", () => {
  describe("when the setup screen reads it", () => {
    /** @scenario "An organization with no sign-in route is offered the setup journey" */
    it("reports no route, which is what leaves the setup journey on offer", async () => {
      const view = await selfServe.getSetup({ organizationId: ORG });

      expect(view.connection).toBeNull();
      expect(view.legacyRoute).toBeNull();
    });
  });
});

describe("given an organization whose old route has already been recorded", () => {
  describe("when the setup screen reads it", () => {
    /** @scenario "An organization already routing sign-in is not offered a second connection" */
    it("stops reporting the strings, because the connection is the better answer", async () => {
      legacySso = { ssoDomain: "acme.test", ssoProvider: "auth0" };
      await register();

      const view = await selfServe.getSetup({ organizationId: ORG });

      // A recorded connection outranks the strings it was derived from;
      // reporting both would let one screen hold two answers to one question.
      expect(view.connection).not.toBeNull();
      expect(view.legacyRoute).toBeNull();
    });
  });
});
