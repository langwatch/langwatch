import { createApiFixture } from "@langwatch/api-fixture";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { SeedDemoService } from "../seed-demo.service.ts";

describe("SeedDemoService", () => {
  /** @scenario "A deployment with no allowlist seeds nothing on its daily wake" */
  it("reads nothing on a scheduled run where no allowlist is configured", async () => {
    const service = SeedDemoService.create({
      organizations: createApiFixture<OrganizationApi>({}),
      demoOrgIds: undefined,
      logger: createTestLogger().logger,
      now: () => nowInstant(),
    });

    await expect(service.runScheduled()).resolves.toBeUndefined();
  });
});
