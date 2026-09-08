import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";
import { installWorkerFeatureFlags } from "../worker-feature-flags.composition.ts";
import { resolveWorkerConfig } from "../../platform/config/worker.config.ts";

/**
 * Spec: specs/trace-processing/worker-record-span-capability-services.feature
 *
 * A COMPOSITION-CAPABILITY test. Two of `command:recordSpan`'s four ports are
 * behind kill switches — `token-estimation-killswitch` and its per-project
 * sibling, and the redaction path's own flags — so a process that could not
 * read a flag would keep estimating and keep redacting after an operator threw
 * the switch. What has to be true today is that this process can install the
 * flag app over the client, the Redis and the three tenant directories it
 * already holds, and that an absent Redis degrades rather than refuses.
 */

/** Every row read refuses, which is what makes the two reads below evidence. */
function unreadableRows(): PrismaClient {
  return createApiFixture<PrismaClient>({}, "worker flag rows");
}

/** The three directories a tenant-targeted read is authorized against. */
function peers() {
  return {
    permissions: createApiFixture<AuthzApi>({}, "worker flag permissions"),
    projects: createApiFixture<ProjectApi>({}, "worker flag projects"),
    organizations: createApiFixture<OrganizationApi>({}, "worker flag organizations"),
  };
}

describe("installWorkerFeatureFlags", () => {
  describe("given a deployment with no Redis to share", () => {
    describe("when the flag app is installed", () => {
      /** @scenario "The flag service composes without a shared cache" */
      it("installs the app rather than refusing", async () => {
        const flags = await installWorkerFeatureFlags({
          prisma: unreadableRows(),
          config: resolveWorkerConfig({}),
          redis: null,
          peers: peers(),
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
       * deployment's overrides ever reached the app, so it would prove
       * nothing — the first draft of this test used one, and a sabotage that
       * dropped `config.featureFlags` entirely came back green.
       *
       * The control is the same key without the force-enable: resolution falls
       * through to the stored row, this world has no readable rows, and the
       * store degrades to the registry default, which is off. A force-enable
       * that never reached the app would answer off the same way.
       *
       * @scenario "An environment force-enable is honoured without a stored row" */
      it("answers enabled with no row in the database", async () => {
        const off = await installWorkerFeatureFlags({
          prisma: unreadableRows(),
          config: resolveWorkerConfig({}),
          redis: null,
          peers: peers(),
        });
        const forced = await installWorkerFeatureFlags({
          prisma: unreadableRows(),
          config: resolveWorkerConfig({
            FEATURE_FLAG_FORCE_ENABLE: "token-estimation-killswitch",
          }),
          redis: null,
          peers: peers(),
        });

        await expect(
          forced.isEnabled("token-estimation-killswitch", { kind: "system" }),
        ).resolves.toBe(true);
        await expect(
          off.isEnabled("token-estimation-killswitch", { kind: "system" }),
        ).resolves.toBe(false);
      });
    });
  });
});
