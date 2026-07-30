import { beforeEach, describe, expect, it } from "vitest";
import { ProvisioningService } from "../app/provisioning.service.js";
import { RateLimitGuard } from "../app/rate-limit.guard.js";
import { defaultRateLimitConfig, resolveConfig } from "../domain/config.js";
import {
  AnonymousProvisioningDisabledError,
  EphemeralAccountNotFoundError,
  OnboardingRateLimitedError,
} from "../domain/errors.js";
import { peppered } from "../domain/tokens.js";
import {
  FakeAccountRepository,
  FakeClock,
  FakeRateLimiter,
  FakeWorkspaceProvisioner,
} from "./fakes.js";

const PEPPER = "test-pepper";
const NOW = new Date("2026-01-01T00:00:00Z");
const identity = { ip: "203.0.113.9", fingerprint: "fp-".padEnd(20, "y") };

let accounts: FakeAccountRepository;
let workspaces: FakeWorkspaceProvisioner;
let limiter: FakeRateLimiter;
let clock: FakeClock;

function serviceWith(overrides: { provisioningEnabled?: boolean } = {}) {
  const config = resolveConfig({
    appBaseUrl: "https://app.example.com",
    ...overrides,
  });
  return new ProvisioningService({
    accounts,
    workspaces,
    guard: new RateLimitGuard(limiter, defaultRateLimitConfig, PEPPER),
    config,
    pepper: PEPPER,
    clock,
  });
}

beforeEach(() => {
  accounts = new FakeAccountRepository();
  workspaces = new FakeWorkspaceProvisioner();
  limiter = new FakeRateLimiter();
  clock = new FakeClock(NOW);
});

describe("provisioning a temporary account", () => {
  describe("given an unauthenticated caller within its budget", () => {
    it("returns an ingestion key, the project, and a claim token", async () => {
      const response = await serviceWith().provision({
        request: { agent: "claude_code" },
        identity,
      });

      expect(response.ingestion.apiKey).toBe("ik-lw-token-1");
      expect(response.account.projectId).toBe("proj_1");
      expect(response.claim.token).toBeTruthy();
    });

    it("states both deadlines as absolute timestamps", async () => {
      const response = await serviceWith().provision({
        request: { agent: "claude_code" },
        identity,
      });

      expect(response.lifecycle.ingestionStopsAt).toBe(
        "2026-01-08T00:00:00.000Z",
      );
      expect(response.lifecycle.deleteAfter).toBe("2026-01-31T00:00:00.000Z");
      expect(response.claim.claimableUntil).toBe("2026-01-31T00:00:00.000Z");
    });

    it("names the project after the agent when the caller didn't", async () => {
      const response = await serviceWith().provision({
        request: { agent: "codex" },
        identity,
      });

      expect(response.account.projectName).toBe("Codex");
    });

    it("points the agent at the OTLP endpoint of this deployment", async () => {
      const response = await serviceWith().provision({
        request: { agent: "claude_code" },
        identity,
      });

      expect(response.ingestion.otlpEndpoint).toBe(
        "https://app.example.com/api/otel",
      );
    });
  });

  describe("what it persists", () => {
    it("keeps only a hash of the claim token", async () => {
      const service = serviceWith();
      const response = await service.provision({
        request: { agent: "claude_code" },
        identity,
      });

      const stored = [...accounts.tokens.keys()];
      expect(stored).toEqual([peppered(response.claim.token, PEPPER)]);
      expect(stored).not.toContain(response.claim.token);
    });

    it("keeps only hashes of the fingerprint and the address", async () => {
      const capture: string[] = [];
      const originalCreate = accounts.create.bind(accounts);
      accounts.create = async (params) => {
        capture.push(String(params.fingerprintHash), String(params.ipHash));
        return originalCreate(params);
      };

      await serviceWith().provision({
        request: { agent: "claude_code" },
        identity,
      });

      expect(capture).toEqual([
        peppered(identity.fingerprint, PEPPER),
        peppered(identity.ip, PEPPER),
      ]);
      expect(capture).not.toContain(identity.ip);
      expect(capture).not.toContain(identity.fingerprint);
    });

    it.each([
      { label: "no header at all", fingerprint: undefined },
      { label: "a null fingerprint", fingerprint: null },
      { label: "an empty header value", fingerprint: "" },
    ])("records no fingerprint given $label", async ({ fingerprint }) => {
      let seen: string | null = "unset";
      const originalCreate = accounts.create.bind(accounts);
      accounts.create = async (params) => {
        seen = params.fingerprintHash;
        return originalCreate(params);
      };

      await serviceWith().provision({
        request: { agent: "claude_code" },
        identity: { ip: identity.ip, fingerprint },
      });

      expect(seen).toBeNull();
    });

    it("does not meter an empty fingerprint as a shared bucket", async () => {
      // An empty header value hashing to one key would mean the first
      // fingerprint-less caller to exhaust it refuses every other one.
      await serviceWith().provision({
        request: { agent: "claude_code" },
        identity: { ip: identity.ip, fingerprint: "" },
      });

      expect(limiter.axesTouched()).not.toContain("fingerprint");
    });
  });

  describe("when an axis has already refused this caller", () => {
    beforeEach(() => {
      limiter.exhausted.add("fingerprint");
    });

    it("refuses", async () => {
      await expect(
        serviceWith().provision({
          request: { agent: "claude_code" },
          identity,
        }),
      ).rejects.toBeInstanceOf(OnboardingRateLimitedError);
    });

    it("creates nothing at all", async () => {
      await serviceWith()
        .provision({ request: { agent: "claude_code" }, identity })
        .catch(() => void 0);

      expect(workspaces.provisionCalls).toBe(0);
      expect(accounts.rows.size).toBe(0);
    });
  });

  describe("when the deployment has anonymous provisioning turned off", () => {
    it("refuses before metering or creating anything", async () => {
      const service = serviceWith({ provisioningEnabled: false });

      await expect(
        service.provision({ request: { agent: "claude_code" }, identity }),
      ).rejects.toBeInstanceOf(AnonymousProvisioningDisabledError);

      expect(limiter.consumed).toEqual([]);
      expect(workspaces.provisionCalls).toBe(0);
    });
  });

  describe("when creating the workspace fails", () => {
    it("does not leave an account row pointing at nothing", async () => {
      workspaces.failure = new Error("key mint exploded");

      await expect(
        serviceWith().provision({
          request: { agent: "claude_code" },
          identity,
        }),
      ).rejects.toThrow("key mint exploded");

      expect(accounts.rows.size).toBe(0);
    });
  });
});

describe("reading an account's status", () => {
  describe("given a claim token that resolves", () => {
    it("reports the phase and the countdown", async () => {
      const service = serviceWith();
      const provisioned = await service.provision({
        request: { agent: "claude_code" },
        identity,
      });

      clock.advanceDays(8);
      const status = await service.status({
        claimToken: provisioned.claim.token,
      });

      expect(status.lifecycle.state).toBe("read_only");
      expect(status.lifecycle.daysRemainingInPhase).toBe(22);
    });

    it("still answers after the deletion deadline, rather than erroring", async () => {
      const service = serviceWith();
      const provisioned = await service.provision({
        request: { agent: "claude_code" },
        identity,
      });

      clock.advanceDays(31);
      const status = await service.status({
        claimToken: provisioned.claim.token,
      });

      expect(status.lifecycle.state).toBe("expired");
    });
  });

  describe("given a claim token that does not resolve", () => {
    it("answers not-found", async () => {
      await expect(
        serviceWith().status({ claimToken: "nope" }),
      ).rejects.toBeInstanceOf(EphemeralAccountNotFoundError);
    });
  });
});
