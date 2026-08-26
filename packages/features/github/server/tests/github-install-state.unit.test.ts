import { createHmac } from "node:crypto";
import type { GithubInstallStatePayload } from "@langwatch/github-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GithubInstallStateAdapter } from "../src/adapters/github-install-state.adapter";

const SIGNING_KEY = "test-secret-not-real";
const NOW = 1_700_000_000_000;
const STATE_TTL_MS = GithubInstallStateAdapter.create({
  signingKey: SIGNING_KEY,
  redis: null,
}).getTtlMs();

function signGithubInstallState(
  payload: GithubInstallStatePayload,
  signingKey: string,
): string {
  return GithubInstallStateAdapter.create({
    signingKey,
    redis: null,
  }).sign(payload);
}

function signUnknownState(payload: unknown, signingKey: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", signingKey).update(body).digest("base64url");

  return `${body}.${signature}`;
}

function verifyGithubInstallState(
  token: string | null | undefined,
  signingKey: string,
  now: number,
): GithubInstallStatePayload | null {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  return GithubInstallStateAdapter.create({
    signingKey,
    redis: null,
  }).tryVerify(token);
}

afterEach(() => {
  vi.useRealTimers();
});

function makePayload(
  overrides: Partial<GithubInstallStatePayload> = {},
): GithubInstallStatePayload {
  return {
    userId: "user-1",
    organizationId: "org-1",
    mode: "popup",
    returnTo: "/settings/integrations#github",
    issuedAt: NOW,
    nonce: "n",
    nonceRegistered: true,
    ...overrides,
  };
}

describe("signGithubInstallState + verifyGithubInstallState", () => {
  describe("when a fresh state is verified with the right key", () => {
    it("round-trips the payload exactly", () => {
      const token = signGithubInstallState(makePayload(), SIGNING_KEY);
      expect(verifyGithubInstallState(token, SIGNING_KEY, NOW)).toEqual(makePayload());
    });
  });

  describe("when the signing key differs", () => {
    it("returns null without throwing", () => {
      const token = signGithubInstallState(makePayload(), SIGNING_KEY);
      expect(verifyGithubInstallState(token, "another-key", NOW)).toBeNull();
    });
  });

  describe("when the body is tampered after signing", () => {
    it("returns null", () => {
      const token = signGithubInstallState(makePayload(), SIGNING_KEY);
      const [body, sig] = token.split(".");
      const tampered =
        Buffer.from(JSON.stringify(makePayload({ userId: "attacker" })), "utf8").toString(
          "base64url",
        ) +
        "." +
        sig;
      expect(verifyGithubInstallState(tampered, SIGNING_KEY, NOW)).toBeNull();
      expect(body).toBeTruthy(); // sanity: original body decoded
    });
  });

  describe("when the signature is malformed", () => {
    it.each(["", "no-dot", "body.", ".sig"])("returns null for %s", (token) => {
      expect(verifyGithubInstallState(token, SIGNING_KEY, NOW)).toBeNull();
    });
  });

  describe("when the state is older than the TTL", () => {
    it("returns null even though the signature is valid", () => {
      const token = signGithubInstallState(makePayload(), SIGNING_KEY);
      expect(
        verifyGithubInstallState(token, SIGNING_KEY, NOW + STATE_TTL_MS + 1),
      ).toBeNull();
    });
  });

  describe("when the payload claims a future issuedAt beyond clock skew", () => {
    it("returns null — can only be a skewed signer or a clock-rollback replay", () => {
      const token = signGithubInstallState(
        makePayload({ issuedAt: NOW + 5 * 60 * 1000 }),
        SIGNING_KEY,
      );
      expect(verifyGithubInstallState(token, SIGNING_KEY, NOW)).toBeNull();
    });
  });

  describe("when nonce or returnTo are not strings", () => {
    it("returns null for a non-string nonce", () => {
      const token = signUnknownState({ ...makePayload(), nonce: 42 }, SIGNING_KEY);
      expect(verifyGithubInstallState(token, SIGNING_KEY, NOW)).toBeNull();
    });
    it("returns null for a non-string returnTo", () => {
      const token = signUnknownState({ ...makePayload(), returnTo: null }, SIGNING_KEY);
      expect(verifyGithubInstallState(token, SIGNING_KEY, NOW)).toBeNull();
    });
  });

  describe("when nonceRegistered is missing (pre-flag token shape)", () => {
    it("returns null so old states can't dodge the replay check", () => {
      const { nonceRegistered: _omit, ...legacy } = makePayload();
      const token = signUnknownState(legacy, SIGNING_KEY);
      expect(verifyGithubInstallState(token, SIGNING_KEY, NOW)).toBeNull();
    });
  });

  describe("when the payload has an unknown mode", () => {
    it("returns null", () => {
      const token = signUnknownState({ ...makePayload(), mode: "weird" }, SIGNING_KEY);
      expect(verifyGithubInstallState(token, SIGNING_KEY, NOW)).toBeNull();
    });
  });
});
