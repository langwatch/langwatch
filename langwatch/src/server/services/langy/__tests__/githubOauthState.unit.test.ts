import { describe, expect, it } from "vitest";

import {
  STATE_TTL_MS,
  signGithubOauthState,
  verifyGithubOauthState,
  type GithubOauthStatePayload,
} from "../githubOauthState";

const SIGNING_KEY = "test-secret-not-real";
const NOW = 1_700_000_000_000;

function makePayload(
  overrides: Partial<GithubOauthStatePayload> = {},
): GithubOauthStatePayload {
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

describe("signGithubOauthState + verifyGithubOauthState", () => {
  describe("when a fresh state is verified with the right key", () => {
    it("round-trips the payload exactly", () => {
      const token = signGithubOauthState(makePayload(), SIGNING_KEY);
      expect(verifyGithubOauthState(token, SIGNING_KEY, NOW)).toEqual(
        makePayload(),
      );
    });
  });

  describe("when the signing key differs", () => {
    it("returns null without throwing", () => {
      const token = signGithubOauthState(makePayload(), SIGNING_KEY);
      expect(verifyGithubOauthState(token, "another-key", NOW)).toBeNull();
    });
  });

  describe("when the body is tampered after signing", () => {
    it("returns null", () => {
      const token = signGithubOauthState(makePayload(), SIGNING_KEY);
      const [body, sig] = token.split(".");
      const tampered =
        Buffer.from(
          JSON.stringify(makePayload({ userId: "attacker" })),
          "utf8",
        ).toString("base64url") +
        "." +
        sig;
      expect(verifyGithubOauthState(tampered, SIGNING_KEY, NOW)).toBeNull();
      expect(body).toBeTruthy(); // sanity: original body decoded
    });
  });

  describe("when the signature is malformed", () => {
    it.each(["", "no-dot", "body.", ".sig"])("returns null for %s", (token) => {
      expect(verifyGithubOauthState(token, SIGNING_KEY, NOW)).toBeNull();
    });
  });

  describe("when the state is older than the TTL", () => {
    it("returns null even though the signature is valid", () => {
      const token = signGithubOauthState(makePayload(), SIGNING_KEY);
      expect(
        verifyGithubOauthState(token, SIGNING_KEY, NOW + STATE_TTL_MS + 1),
      ).toBeNull();
    });
  });

  describe("when the payload claims a future issuedAt beyond clock skew", () => {
    it("returns null — can only be a skewed signer or a clock-rollback replay", () => {
      const token = signGithubOauthState(
        makePayload({ issuedAt: NOW + 5 * 60 * 1000 }),
        SIGNING_KEY,
      );
      expect(verifyGithubOauthState(token, SIGNING_KEY, NOW)).toBeNull();
    });
  });

  describe("when nonce or returnTo are not strings", () => {
    it("returns null for a non-string nonce", () => {
      const token = signGithubOauthState(
        makePayload({ nonce: 42 as unknown as string }),
        SIGNING_KEY,
      );
      expect(verifyGithubOauthState(token, SIGNING_KEY, NOW)).toBeNull();
    });
    it("returns null for a non-string returnTo", () => {
      const token = signGithubOauthState(
        makePayload({ returnTo: null as unknown as string }),
        SIGNING_KEY,
      );
      expect(verifyGithubOauthState(token, SIGNING_KEY, NOW)).toBeNull();
    });
  });

  describe("when nonceRegistered is missing (pre-flag token shape)", () => {
    it("returns null so old states can't dodge the replay check", () => {
      const { nonceRegistered: _omit, ...legacy } = makePayload();
      const token = signGithubOauthState(
        legacy as GithubOauthStatePayload,
        SIGNING_KEY,
      );
      expect(verifyGithubOauthState(token, SIGNING_KEY, NOW)).toBeNull();
    });
  });

  describe("when the payload has an unknown mode", () => {
    it("returns null", () => {
      const token = signGithubOauthState(
        // Intentionally cast through unknown — we are simulating a tampered
        // payload that round-trips JSON but fails the runtime schema check.
        makePayload({ mode: "weird" as unknown as "popup" }),
        SIGNING_KEY,
      );
      expect(verifyGithubOauthState(token, SIGNING_KEY, NOW)).toBeNull();
    });
  });
});
