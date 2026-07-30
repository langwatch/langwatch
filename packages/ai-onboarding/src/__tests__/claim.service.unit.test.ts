import { beforeEach, describe, expect, it } from "vitest";
import { ClaimService } from "../app/claim.service.js";
import { RateLimitGuard } from "../app/rate-limit.guard.js";
import { defaultRateLimitConfig, resolveConfig } from "../domain/config.js";
import {
  ClaimHandoffNotFoundError,
  ClaimHandoffVerifierMismatchError,
  EphemeralAccountAlreadyClaimedError,
  EphemeralAccountExpiredError,
  EphemeralAccountNotFoundError,
  OnboardingRateLimitedError,
  PasskeyChallengeMissingError,
  PasskeyRegistrationFailedError,
} from "../domain/errors.js";
import { deriveCodeChallenge, mintSecret, peppered } from "../domain/tokens.js";
import {
  anAccount,
  FakeAccountRepository,
  FakeClock,
  FakeHandoffStore,
  FakePasskeyRepository,
  FakeRateLimiter,
  FakeWebAuthnCeremony,
  FakeWorkspaceProvisioner,
} from "./fakes.js";

const PEPPER = "test-pepper";
const PROVISIONED = new Date("2026-01-01T00:00:00Z");
const CLAIM_TOKEN = "claim-token-abc";
const identity = { ip: "203.0.113.5", fingerprint: null };

let accounts: FakeAccountRepository;
let handoffs: FakeHandoffStore;
let workspaces: FakeWorkspaceProvisioner;
let limiter: FakeRateLimiter;
let passkeys: FakePasskeyRepository;
let ceremony: FakeWebAuthnCeremony;
let clock: FakeClock;
let service: ClaimService;

function seedAccount(overrides = {}) {
  const account = anAccount({ provisionedAt: PROVISIONED, ...overrides });
  accounts.seed(account, peppered(CLAIM_TOKEN, PEPPER));
  return account;
}

beforeEach(() => {
  accounts = new FakeAccountRepository();
  handoffs = new FakeHandoffStore();
  workspaces = new FakeWorkspaceProvisioner();
  limiter = new FakeRateLimiter();
  passkeys = new FakePasskeyRepository();
  ceremony = new FakeWebAuthnCeremony();
  clock = new FakeClock(new Date(PROVISIONED.getTime() + 2 * 86_400_000));

  service = new ClaimService({
    accounts,
    handoffs,
    workspaces,
    guard: new RateLimitGuard(limiter, defaultRateLimitConfig, PEPPER),
    config: resolveConfig({ appBaseUrl: "https://app.example.com" }),
    pepper: PEPPER,
    passkeys,
    ceremony,
    clock,
  });
});

describe("claiming from a CLI that already has an identity", () => {
  describe("given an unclaimed account inside its window", () => {
    beforeEach(() => seedAccount());

    /** @scenario "a logged-in CLI claims without opening a browser" */
    it("hands ownership to the caller and retires the placeholder", async () => {
      await service.claimDirect({
        claimToken: CLAIM_TOKEN,
        userId: "user_1",
        identity,
      });

      expect(workspaces.transferred).toEqual([
        {
          organizationId: "org_seed",
          placeholderUserId: "user_placeholder_seed",
          claimingUserId: "user_1",
        },
      ]);
      expect(workspaces.promoted).toEqual([]);
    });

    /** @scenario "claiming as the placeholder itself promotes it in place" */
    it("promotes in place when the claimer IS the placeholder", async () => {
      // The passkey path: the credential was enrolled against the placeholder,
      // so nothing changes hands and there is no window with two admins.
      await service.claimDirect({
        claimToken: CLAIM_TOKEN,
        userId: "user_placeholder_seed",
        identity,
      });

      expect(workspaces.promoted).toEqual([
        {
          placeholderUserId: "user_placeholder_seed",
          email: null,
          name: null,
        },
      ]);
      expect(workspaces.transferred).toEqual([]);
    });

    /** @scenario "claiming cancels the reaper" */
    it("clears both deadlines, taking it off the reaper's list", async () => {
      await service.claimDirect({
        claimToken: CLAIM_TOKEN,
        userId: "user_1",
        identity,
      });

      const row = await accounts.findById("acct_seed");
      expect(row?.claimedAt).not.toBeNull();
      expect(row?.deleteAfter).toBeNull();
      expect(row?.ingestionStopsAt).toBeNull();
    });

    /** @scenario "claiming keeps the ingestion key exactly as it was" */
    it("leaves the project — and so the agent's key — untouched", async () => {
      const result = await service.claimDirect({
        claimToken: CLAIM_TOKEN,
        userId: "user_1",
        identity,
      });

      expect(result.account.projectId).toBe("proj_seed");
    });
  });

  describe("given an account already claimed by someone else", () => {
    beforeEach(() =>
      seedAccount({
        claimedAt: new Date(PROVISIONED.getTime() + 86_400_000),
        claimedByUserId: "user_first",
        ingestionStopsAt: null,
        deleteAfter: null,
      }),
    );

    /** @scenario "claiming an already-claimed account is refused, not silently re-run" */
    it("refuses rather than silently re-running", async () => {
      await expect(
        service.claimDirect({
          claimToken: CLAIM_TOKEN,
          userId: "user_second",
          identity,
        }),
      ).rejects.toBeInstanceOf(EphemeralAccountAlreadyClaimedError);
    });

    it("does not change ownership", async () => {
      await service
        .claimDirect({
          claimToken: CLAIM_TOKEN,
          userId: "user_second",
          identity,
        })
        .catch(() => void 0);

      const row = await accounts.findById("acct_seed");
      expect(row?.claimedByUserId).toBe("user_first");
      expect(workspaces.transferred).toEqual([]);
      expect(workspaces.promoted).toEqual([]);
    });
  });

  describe("given an account inside the read-only window", () => {
    /** @scenario "a claim during the read-only window still works" */
    it("still claims — that window is what the claim exists to rescue", async () => {
      seedAccount();
      clock.set(new Date(PROVISIONED.getTime() + 8 * 86_400_000));

      const result = await service.claimDirect({
        claimToken: CLAIM_TOKEN,
        userId: "user_1",
        identity,
      });

      expect(result.account.projectId).toBe("proj_seed");
    });
  });

  describe("given an account past its deletion deadline", () => {
    /** @scenario "a claim after the deletion deadline is refused" */
    it("tells the owner the data is gone", async () => {
      seedAccount();
      clock.set(new Date(PROVISIONED.getTime() + 31 * 86_400_000));

      await expect(
        service.claimDirect({
          claimToken: CLAIM_TOKEN,
          userId: "user_1",
          identity,
        }),
      ).rejects.toBeInstanceOf(EphemeralAccountExpiredError);
    });
  });

  describe("given any claim attempt", () => {
    beforeEach(() => seedAccount());

    /** @scenario "claim attempts are metered per IP" */
    it("meters it against the per-address claim axis", async () => {
      await service.claimDirect({
        claimToken: CLAIM_TOKEN,
        userId: "user_1",
        identity,
      });

      expect(limiter.axesTouched()).toContain("claim_ip");
    });
  });

  describe("telling a real token from an unknown one", () => {
    /** @scenario "a genuine token past its deadline is told the truth" */
    it("distinguishes an expired account from a token that never existed", async () => {
      seedAccount();
      clock.set(new Date(PROVISIONED.getTime() + 31 * 86_400_000));

      const expired = await service
        .claimDirect({ claimToken: CLAIM_TOKEN, userId: "u", identity })
        .catch((e: unknown) => e);
      const unknown = await service
        .claimDirect({ claimToken: "never-existed", userId: "u", identity })
        .catch((e: unknown) => e);

      // Nobody reaches the expired branch by guessing a 256-bit token, so the
      // only caller who can see it is the owner — and they get the truth.
      expect((expired as EphemeralAccountExpiredError).code).toBe(
        "ephemeral_account_expired",
      );
      expect((unknown as EphemeralAccountNotFoundError).code).toBe(
        "ephemeral_account_not_found",
      );
    });
  });

  describe("given a claim token that does not resolve", () => {
    /** @scenario "a token that does not resolve gets one answer, whatever the reason" */
    it("answers not-found", async () => {
      await expect(
        service.claimDirect({
          claimToken: "wrong",
          userId: "user_1",
          identity,
        }),
      ).rejects.toBeInstanceOf(EphemeralAccountNotFoundError);
    });

    it("counts the miss against the failed-claim axis", async () => {
      await service
        .claimDirect({ claimToken: "wrong", userId: "user_1", identity })
        .catch(() => void 0);

      expect(limiter.axesTouched()).toContain("claim_failure");
    });
  });
});

describe("claiming through a browser handoff", () => {
  const verifier = "v".repeat(64);
  const challenge = deriveCodeChallenge(verifier);

  async function startHandoff(): Promise<string> {
    const started = await service.startHandoff({
      claimToken: CLAIM_TOKEN,
      codeChallenge: challenge,
      identity,
    });
    return started.handoffCode;
  }

  describe("when the CLI starts one", () => {
    beforeEach(() => seedAccount());

    /** @scenario "starting a handoff returns a URL the CLI can open" */
    it("returns a URL to open and an interval to poll", async () => {
      const started = await service.startHandoff({
        claimToken: CLAIM_TOKEN,
        codeChallenge: challenge,
        identity,
      });

      expect(started.claimUrl).toBe(
        `https://app.example.com/claim/${started.handoffCode}`,
      );
      expect(started.pollIntervalSeconds).toBeGreaterThan(0);
    });

    it("stores the record under a hash, not the code in the URL", async () => {
      const code = await startHandoff();

      expect([...handoffs.records.keys()]).toEqual([peppered(code, PEPPER)]);
    });

    /** @scenario "the verifier is checked by hashing, never by storing it" */
    it("stores the challenge and never the verifier", async () => {
      const code = await startHandoff();
      const stored = handoffs.records.get(peppered(code, PEPPER));

      expect(stored?.codeChallenge).toBe(challenge);
      expect(JSON.stringify(stored)).not.toContain(verifier);
    });
  });

  describe("what the browser page can read", () => {
    beforeEach(() => seedAccount());

    /** @scenario "the browser page can describe what is about to be claimed" */
    it("gets what it needs to explain the handoff", async () => {
      const code = await startHandoff();
      const described = await service.describeHandoff({ handoffCode: code });

      expect(described.projectName).toBe("Claude Code");
      expect(described.agent).toBe("claude_code");
    });

    it("never sees the claim token", async () => {
      const code = await startHandoff();
      const described = await service.describeHandoff({ handoffCode: code });

      expect(JSON.stringify(described)).not.toContain(CLAIM_TOKEN);
    });
  });

  describe("while the human has not approved yet", () => {
    beforeEach(() => seedAccount());

    /** @scenario "the CLI's poll returns pending until the human approves" */
    it("answers pending, with the interval to wait", async () => {
      const code = await startHandoff();
      const polled = await service.exchange({
        handoffCode: code,
        codeVerifier: verifier,
      });

      expect(polled.status).toBe("pending");
    });

    /** @scenario "polling the handoff has its own minimum interval" */
    it("refuses a poll that arrives faster than the advertised gap", async () => {
      const code = await startHandoff();
      handoffs.refusePolls = true;

      await expect(
        service.exchange({ handoffCode: code, codeVerifier: verifier }),
      ).rejects.toBeInstanceOf(OnboardingRateLimitedError);
    });
  });

  describe("once the human approves in the browser", () => {
    beforeEach(() => seedAccount());

    /** @scenario "approving in the browser attaches the signed-in identity" */
    it("attaches their identity immediately", async () => {
      const code = await startHandoff();
      await service.approveHandoff({ handoffCode: code, userId: "user_1" });

      expect(workspaces.transferred).toEqual([
        {
          organizationId: "org_seed",
          placeholderUserId: "user_placeholder_seed",
          claimingUserId: "user_1",
        },
      ]);
    });

    /** @scenario "the CLI's poll succeeds once approved" */
    it("lets the CLI's next poll settle", async () => {
      const code = await startHandoff();
      await service.approveHandoff({ handoffCode: code, userId: "user_1" });

      const polled = await service.exchange({
        handoffCode: code,
        codeVerifier: verifier,
      });

      expect(polled.status).toBe("approved");
    });

    /** @scenario "a handoff code is single-use" */
    it("burns the code — a second exchange is gone", async () => {
      const code = await startHandoff();
      await service.approveHandoff({ handoffCode: code, userId: "user_1" });
      await service.exchange({ handoffCode: code, codeVerifier: verifier });

      await expect(
        service.exchange({ handoffCode: code, codeVerifier: verifier }),
      ).rejects.toBeInstanceOf(ClaimHandoffNotFoundError);
    });
  });

  describe("when someone who only saw the URL tries to finish it", () => {
    beforeEach(() => seedAccount());

    /** @scenario "a stolen handoff code is useless without the verifier" */
    it("refuses without the verifier", async () => {
      const code = await startHandoff();

      await expect(
        service.exchange({ handoffCode: code, codeVerifier: "w".repeat(64) }),
      ).rejects.toBeInstanceOf(ClaimHandoffVerifierMismatchError);
    });

    it("leaves the handoff alive for the CLI that started it", async () => {
      const code = await startHandoff();
      await service
        .exchange({ handoffCode: code, codeVerifier: "w".repeat(64) })
        .catch(() => void 0);

      expect(handoffs.records.has(peppered(code, PEPPER))).toBe(true);
    });

    it("cannot even learn whether the human approved yet", async () => {
      const code = await startHandoff();
      await service.approveHandoff({ handoffCode: code, userId: "user_1" });

      await expect(
        service.exchange({ handoffCode: code, codeVerifier: "w".repeat(64) }),
      ).rejects.toBeInstanceOf(ClaimHandoffVerifierMismatchError);
    });
  });

  describe("when the handoff has outlived its window", () => {
    beforeEach(() => seedAccount());

    /** @scenario "a handoff expires long before the account does" */
    it("is gone, while the account itself stays claimable", async () => {
      const code = await startHandoff();
      clock.set(new Date(clock.now().getTime() + 60 * 60 * 1000));

      await expect(
        service.exchange({ handoffCode: code, codeVerifier: verifier }),
      ).rejects.toBeInstanceOf(ClaimHandoffNotFoundError);

      const fresh = await service.startHandoff({
        claimToken: CLAIM_TOKEN,
        codeChallenge: challenge,
        identity,
      });
      expect(fresh.handoffCode).toBeTruthy();
    });
  });

  describe("enrolling a passkey from the phone that scanned the QR", () => {
    beforeEach(() => seedAccount());

    async function beginAndVerify(code: string) {
      await service.beginPasskeyEnrollment({ handoffCode: code });
      return service.completePasskeyEnrollment({
        handoffCode: code,
        response: { id: "cred" },
        label: "iPhone",
      });
    }

    /** @scenario "the phone is offered registration options for the account" */
    it("issues options carrying the code the terminal is showing", async () => {
      const code = await startHandoff();
      const opts = await service.beginPasskeyEnrollment({ handoffCode: code });

      // The human can compare it against their own terminal before touching
      // the sensor.
      expect(opts.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(opts.options).toHaveProperty("challenge");
    });

    /** @scenario "the credential is enrolled against the account's own owner" */
    it("stores the credential against the placeholder that owns the org", async () => {
      const code = await startHandoff();
      await beginAndVerify(code);

      expect(passkeys.stored).toHaveLength(1);
      expect(passkeys.stored[0]?.userId).toBe("user_placeholder_seed");
      expect(passkeys.stored[0]?.label).toBe("iPhone");
    });

    /** @scenario "enrolling claims the account in the same step" */
    it("claims the account in the same step, promoting in place", async () => {
      const code = await startHandoff();
      const result = await beginAndVerify(code);

      expect(result.claimed.account.projectId).toBe("proj_seed");
      // Promote, not transfer: the placeholder already owned everything.
      expect(workspaces.promoted).toHaveLength(1);
      expect(workspaces.transferred).toEqual([]);

      const row = await accounts.findById("acct_seed");
      expect(row?.claimedAt).not.toBeNull();
      expect(row?.deleteAfter).toBeNull();
    });

    /** @scenario "the waiting CLI settles once the phone is done" */
    it("lets the CLI's poll settle once the phone is done", async () => {
      const code = await startHandoff();
      await beginAndVerify(code);

      const polled = await service.exchange({
        handoffCode: code,
        codeVerifier: verifier,
      });
      expect(polled.status).toBe("approved");
    });

    describe("when the attestation does not verify", () => {
      /** @scenario "an attestation that does not verify is refused" */
      it("refuses, and stores nothing", async () => {
        const code = await startHandoff();
        await service.beginPasskeyEnrollment({ handoffCode: code });
        ceremony.verifies = false;

        await expect(
          service.completePasskeyEnrollment({
            handoffCode: code,
            response: { id: "forged" },
          }),
        ).rejects.toBeInstanceOf(PasskeyRegistrationFailedError);

        expect(passkeys.stored).toEqual([]);
      });

      /** @scenario "a failed ceremony leaves the account claimable" */
      it("leaves the account unclaimed", async () => {
        const code = await startHandoff();
        await service.beginPasskeyEnrollment({ handoffCode: code });
        ceremony.verifies = false;

        await service
          .completePasskeyEnrollment({ handoffCode: code, response: {} })
          .catch(() => void 0);

        const row = await accounts.findById("acct_seed");
        expect(row?.claimedAt).toBeNull();
      });
    });

    describe("when verify is called without a preceding options call", () => {
      /** @scenario "the challenge cannot be supplied by the caller" */
      it("refuses rather than trusting a caller-supplied challenge", async () => {
        const code = await startHandoff();

        await expect(
          service.completePasskeyEnrollment({
            handoffCode: code,
            response: { id: "cred" },
          }),
        ).rejects.toBeInstanceOf(PasskeyChallengeMissingError);
      });
    });

    describe("when the account was already claimed", () => {
      /** @scenario "an already-claimed account refuses further enrolment" */
      it("refuses to enrol against it", async () => {
        const code = await startHandoff();
        await beginAndVerify(code);

        await expect(
          service.beginPasskeyEnrollment({ handoffCode: code }),
        ).rejects.toBeInstanceOf(EphemeralAccountAlreadyClaimedError);
      });
    });

    describe("when the handoff has expired", () => {
      /** @scenario "an expired handoff refuses enrolment" */
      it("refuses — the QR is not a standing invitation", async () => {
        const code = await startHandoff();
        clock.set(new Date(clock.now().getTime() + 60 * 60 * 1000));

        await expect(
          service.beginPasskeyEnrollment({ handoffCode: code }),
        ).rejects.toBeInstanceOf(ClaimHandoffNotFoundError);
      });
    });
  });

  describe("when an unknown handoff code is presented", () => {
    it("answers the same as an expired one", async () => {
      await expect(
        service.exchange({
          handoffCode: mintSecret(),
          codeVerifier: verifier,
        }),
      ).rejects.toBeInstanceOf(ClaimHandoffNotFoundError);
    });
  });
});
