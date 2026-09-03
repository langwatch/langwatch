import { describe, expect, it, vi } from "vitest";
import {
  createWorkerFeatureFlags,
  type WorkerFeatureFlagDatabase,
} from "../worker-feature-flags.composition";
import { resolveWorkerConfig } from "../../platform/config/worker.config";

/**
 * Spec: specs/trace-processing/worker-record-span-capability-services.feature
 *
 * A COMPOSITION-CAPABILITY test. Two of `command:recordSpan`'s four ports are
 * behind kill switches — `token-estimation-killswitch` and its per-project
 * sibling, and the redaction path's own flags — so a process that could not
 * read a flag would keep estimating and keep redacting after an operator threw
 * the switch. What has to be true today is that this process can build the
 * flag service from the client and the Redis it already holds, and that an
 * absent Redis degrades rather than refuses.
 */

function database(rows: unknown[] = []): {
  database: WorkerFeatureFlagDatabase;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn(async () => rows);
  return {
    database: {
      featureFlag: { findMany, findUnique: vi.fn(async () => rows[0] ?? null) },
      featureFlagExperimentSetting: {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => null),
      },
    } as unknown as WorkerFeatureFlagDatabase,
    findMany,
  };
}

describe("createWorkerFeatureFlags", () => {
  describe("given a deployment with no Redis to share", () => {
    describe("when the flag service is composed", () => {
      /** @scenario "The flag service composes without a shared cache" */
      it("builds the service rather than refusing", () => {
        const { database: prisma } = database();

        const flags = createWorkerFeatureFlags({
          database: prisma,
          config: resolveWorkerConfig({}),
          redis: null,
        });

        expect(typeof flags.isEnabled).toBe("function");
      });
    });
  });

  describe("given a deployment that force-enabled a flag in its environment", () => {
    describe("when the flag is read", () => {
      /**
       * The switch chosen here is off by default on purpose. A flag whose
       * registry default is already ON answers `true` whether or not the
       * deployment's overrides ever reached the service, so it would prove
       * nothing — the first draft of this test used one, and a sabotage that
       * dropped `config.featureFlags` entirely came back green.
       *
       * @scenario "An environment force-enable is honoured without a stored row" */
      it("answers enabled with no row in the database", async () => {
        const { database: prisma } = database();

        const off = createWorkerFeatureFlags({
          database: prisma,
          config: resolveWorkerConfig({}),
          redis: null,
        });
        const forced = createWorkerFeatureFlags({
          database: prisma,
          config: resolveWorkerConfig({
            FEATURE_FLAG_FORCE_ENABLE: "token-estimation-killswitch",
          }),
          redis: null,
        });

        await expect(
          off.isEnabled("token-estimation-killswitch", { kind: "system" }),
        ).resolves.toBe(false);
        await expect(
          forced.isEnabled("token-estimation-killswitch", { kind: "system" }),
        ).resolves.toBe(true);
      });
    });
  });
});
