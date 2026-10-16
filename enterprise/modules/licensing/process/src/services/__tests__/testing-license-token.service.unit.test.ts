/**
 * The tokens that can only ask for a testing licence (ADR-180 section 2): created by an ops
 * manager for CI, refused once revoked or expired, always verified as the person who made them.
 * Spec: specs/self-hosting/connected-services/testing-licenses.feature
 */
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryTestingLicenseTokenRepository } from "../../repositories/memory/memory.testing-license-token.repository.ts";
import { TestingLicenseTokenService } from "../testing-license-token.service.ts";
import { codeOf } from "./support/registry-doubles.ts";

const START: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

function harness() {
  let now = START;
  const repository = MemoryTestingLicenseTokenRepository.create({ now: () => now });
  const tokens = TestingLicenseTokenService.create({ repository, now: () => now });
  return {
    tokens,
    advance: (hours: number) => {
      now = now.add({ hours });
    },
  };
}

describe("a service token", () => {
  describe("when an ops manager creates one without choosing an expiry", () => {
    /** @scenario "An ops manager creates a service token for CI" */
    it("shows the token once and expires it in 90 days", async () => {
      const { tokens } = harness();

      const minted = await tokens.createService({ name: "GitHub Actions", operatorId: "ops-1" });

      expect(minted.token).toMatch(/^lwtl_/);
      expect(minted.testingLicenseToken).toMatchObject({
        kind: "service",
        name: "GitHub Actions",
        ownerUserId: "ops-1",
        expiresAt: "2026-04-01T00:00:00Z",
        status: "active",
      });
      expect(JSON.stringify(minted.testingLicenseToken)).not.toContain(minted.token);
    });
  });

  describe("when the expiry asked for is longer than a year", () => {
    /** @scenario "An ops manager creates a service token for CI" */
    it("is refused with a code naming the limit", async () => {
      const { tokens } = harness();

      await expect(
        codeOf(tokens.createService({ name: "CI", expiresInDays: 366, operatorId: "ops-1" })),
      ).resolves.toBe("testing_license_service_token_lifetime_too_long");
    });
  });

  describe("when it was revoked, or has run out", () => {
    /** @scenario "A revoked or expired service token issues nothing" */
    it("is refused at verification, each by its own code", async () => {
      const { tokens, advance } = harness();
      const revoked = await tokens.createService({ name: "old CI", operatorId: "ops-1" });
      const expiring = await tokens.createService({
        name: "short CI",
        expiresInDays: 1,
        operatorId: "ops-1",
      });
      await tokens.revoke({ id: revoked.testingLicenseToken.id, operatorId: "ops-2" });
      advance(25);

      await expect(codeOf(tokens.verify({ bearer: revoked.token }))).resolves.toBe(
        "testing_license_token_revoked",
      );
      await expect(codeOf(tokens.verify({ bearer: expiring.token }))).resolves.toBe(
        "testing_license_token_expired",
      );
    });
  });

  describe("when a bearer was never issued, or is not shaped like a token", () => {
    /** @scenario "A revoked or expired service token issues nothing" */
    it("is refused as not valid", async () => {
      const { tokens } = harness();

      await expect(codeOf(tokens.verify({ bearer: "lwtl_unknown" }))).resolves.toBe(
        "testing_license_token_invalid",
      );
      await expect(codeOf(tokens.verify({ bearer: "lwl_licence" }))).resolves.toBe(
        "testing_license_token_invalid",
      );
      await expect(codeOf(tokens.verify({ bearer: null }))).resolves.toBe(
        "testing_license_token_invalid",
      );
    });
  });

  describe("when it is verified", () => {
    /** @scenario "A service token stops when the person who made it loses ops permissions" */
    it("answers the person who made it, whom the door then asks for ops permissions", async () => {
      const { tokens } = harness();
      const minted = await tokens.createService({ name: "GitHub Actions", operatorId: "ops-1" });

      await expect(tokens.verify({ bearer: minted.token })).resolves.toEqual({
        kind: "service",
        tokenId: minted.testingLicenseToken.id,
        userId: "ops-1",
      });
    });
  });
});

describe("the token list", () => {
  describe("when an ops manager opens it", () => {
    /** @scenario "Ops managers see every service token and when it was last used" */
    it("shows each token's name, maker, expiry and last use, and any ops manager revokes one", async () => {
      const { tokens, advance } = harness();
      const minted = await tokens.createService({ name: "GitHub Actions", operatorId: "ops-1" });
      await tokens.mintPersonal({ userId: "dev-1" });
      advance(1);
      await tokens.recordUse({ tokenId: minted.testingLicenseToken.id });

      const page = await tokens.list({ page: 0, pageSize: 50 });
      const service = page.tokens.find((token) => token.kind === "service");

      expect(page.total).toBe(2);
      expect(service).toMatchObject({
        name: "GitHub Actions",
        ownerUserId: "ops-1",
        expiresAt: "2026-04-01T00:00:00Z",
        lastUsedAt: "2026-01-01T01:00:00Z",
      });
      expect(JSON.stringify(page)).not.toContain(minted.token);

      const revoked = await tokens.revoke({
        id: minted.testingLicenseToken.id,
        operatorId: "ops-2",
      });
      expect(revoked).toMatchObject({ status: "revoked", revokedById: "ops-2" });
    });
  });

  describe("when the token to revoke does not exist", () => {
    /** @scenario "Ops managers see every service token and when it was last used" */
    it("is refused as not found", async () => {
      const { tokens } = harness();

      await expect(codeOf(tokens.revoke({ id: "missing", operatorId: "ops-1" }))).resolves.toBe(
        "testing_license_token_not_found",
      );
    });
  });
});

describe("a personal token", () => {
  describe("when the CLI sign-in mints one", () => {
    /** @scenario "Cloud staff get a testing license with no browser step" */
    it("verifies as its person until it runs out", async () => {
      const { tokens } = harness();

      const minted = await tokens.mintPersonal({ userId: "dev-1" });
      const issuer = await tokens.verify({ bearer: minted.token });

      expect(issuer).toMatchObject({ kind: "personal", userId: "dev-1" });
      expect(minted.expiresAt).toBe("2026-04-01T00:00:00Z");
    });
  });

  describe("when its person revokes it", () => {
    /** @scenario "Signing haven out revokes its token on Cloud" */
    it("is refused as revoked on the next ask, naming its person as the revoker", async () => {
      const { tokens } = harness();
      const minted = await tokens.mintPersonal({ userId: "dev-1" });
      const issuer = await tokens.verify({ bearer: minted.token });

      const revoked = await tokens.revoke({ id: issuer.tokenId, operatorId: issuer.userId });

      expect(revoked).toMatchObject({ status: "revoked", revokedById: "dev-1" });
      await expect(codeOf(tokens.verify({ bearer: minted.token }))).resolves.toBe(
        "testing_license_token_revoked",
      );
    });
  });
});
