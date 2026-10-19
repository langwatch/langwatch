/**
 * The live scenario repository seals and opens a run's secret parameters with the
 * deployment's cipher, byte-compatible with what an earlier release sealed.
 * @see modules/scenario/specs/scenario-service.feature
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { aesEncryption } from "@langwatch/process-stores";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ScenarioRunSecretsService } from "../../../services/scenario-run-secrets.service.ts";
import { PrismaScenarioRepository } from "../scenario.repository.ts";

/** A test key, never a deployment's: 32 bytes of 0x0f. */
const KEY = Buffer.from("0f".repeat(32), "hex");

/** Sealed under KEY with AES-256-GCM before the repository held the cipher. */
const SEALED_BEFORE =
  "152c5e08fa3a5a53f7e29df3:8ee4ec5a4a4936f0e4d74b07b35941daa2:c07822f207af7e048321105564706149";

function liveRepository() {
  return PrismaScenarioRepository.create(createApiFixture<PrismaClient>(), aesEncryption(KEY));
}

describe("PrismaScenarioRepository", () => {
  describe("given a run secret an earlier release sealed with this deployment's key", () => {
    /** @scenario "A run secret sealed by an earlier release opens through the live scenario repository" */
    it("opens it in plaintext for the run", () => {
      const runSecrets = ScenarioRunSecretsService.create(liveRepository());

      expect(runSecrets.decrypt({ apiToken: SEALED_BEFORE })).toEqual({
        apiToken: "tok-sealed-before",
      });
    });
  });

  describe("given a run secret the live repository sealed", () => {
    /** @scenario "What the live scenario repository seals, an earlier release opens" */
    it("is opened unchanged by the deployment's cipher as an earlier release read it", () => {
      const sealed = liveRepository().sealRunSecret({ plain: "tok-written-now" });

      expect(aesEncryption(KEY).decrypt(sealed)).toBe("tok-written-now");
      expect(sealed).not.toContain("tok-written-now");
    });
  });
});
