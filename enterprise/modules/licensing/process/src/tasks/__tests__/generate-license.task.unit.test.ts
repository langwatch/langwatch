// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/license-registry.feature
 */
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
import { Task } from "@langwatch/task";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { TEST_LICENSING_CONFIG } from "../../__tests__/testing.ts";
import { licensingProcessModule } from "../../licensing.module.ts";
import { GenerateLicenseTask } from "../generate-license.task.ts";

describe("given the licensing module installed in the tasks role", () => {
  it("collects the generate-license task by name", async () => {
    const state = await licensingProcessModule.install({
      resources: new ResourceScope(),
      config: TEST_LICENSING_CONFIG,
      repositorySelection: { tier: "memory", members: {} },
      role: "tasks",
      secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
      resolve: () => createApiFixture<never>(),
    });

    const names = (state.tasks ?? []).flatMap((task) => (task instanceof Task ? [task.name] : []));
    expect(names).toContain("generate-license");
  });
});

describe("given main's generate-license flags", () => {
  describe("when the task runs", () => {
    it("hands the parsed request to the mint", async () => {
      const applyToOrganization = vi.fn().mockResolvedValue({
        organizationId: "org-1",
        organizationName: "Acme",
        planType: "GROWTH",
        licenseId: "lic-1",
        expiresAt: "2027-01-01T00:00:00.000Z",
      });
      const task = GenerateLicenseTask.create({ mint: { applyToOrganization } });

      await task.run({
        args: ["--org-id", "org-1", "--plan", "growth", "--max-members", "7"],
        signal: new AbortController().signal,
      });

      expect(applyToOrganization).toHaveBeenCalledWith({
        organizationId: "org-1",
        planType: "GROWTH",
        maxMembers: 7,
      });
    });
  });

  describe("when --org-id is missing", () => {
    it("refuses before minting", async () => {
      const applyToOrganization = vi.fn();
      const task = GenerateLicenseTask.create({ mint: { applyToOrganization } });

      await expect(
        task.run({ args: ["--plan", "PRO"], signal: new AbortController().signal }),
      ).rejects.toThrow("--org-id is required");
      expect(applyToOrganization).not.toHaveBeenCalled();
    });
  });
});
