import { SecretsChain } from "@langwatch/secrets";
import { describe, expect, it, vi } from "vitest";

import { resolveTasksConfig, type TaskInput } from "../config.ts";
import { lwqlProvision } from "../lwql-provision.ts";
import { prismaMigrate } from "../prisma-migrate.ts";

const spawned = vi.hoisted(() => ({ spawn: vi.fn() }));
const provisioned = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawned.spawn }));
vi.mock("@langwatch/analytics-process", () => ({
  LwqlProvisionTask: { create: provisioned.create },
}));

function skipping(environment: Record<string, string>): TaskInput {
  return {
    config: resolveTasksConfig({ NODE_ENV: "test", ...environment }),
    connections: { database: null, redis: null },
    chain: SecretsChain.start({ environment: {} }),
    environment,
    signal: new AbortController().signal,
  };
}

describe("given a deploy that migrated elsewhere", () => {
  describe("when SKIP_PRISMA_MIGRATE is true", () => {
    /** @scenario An operator can skip a migration step that a deploy already applied */
    it("starts no migration process and lets the boot continue", async () => {
      await expect(
        prismaMigrate(skipping({ SKIP_PRISMA_MIGRATE: "true" })),
      ).resolves.toBeUndefined();

      expect(spawned.spawn).not.toHaveBeenCalled();
    });
  });

  describe("when SKIP_LWQL_PROVISION is true", () => {
    /** @scenario An operator can skip a migration step that a deploy already applied */
    it("provisions nothing, and asks for no database either", async () => {
      await expect(
        lwqlProvision(skipping({ SKIP_LWQL_PROVISION: "true" })),
      ).resolves.toBeUndefined();

      expect(provisioned.create).not.toHaveBeenCalled();
    });
  });

  describe("when the step is not skipped", () => {
    it("still refuses LangWatchQL provisioning without a database", async () => {
      await expect(lwqlProvision(skipping({}))).rejects.toThrow("This task needs DATABASE_URL");
    });
  });
});
