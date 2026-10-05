import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { CostAttributionPolicyRepository } from "../repositories/cost-attribution-policy.repository.ts";
import { PrismaCostAttributionPolicyRepository } from "../repositories/prisma/prisma.cost-attribution-policy.repository.ts";
import { CanonicalCostExtractorService } from "../services/canonical-cost-extractor.service.ts";
import { PostgresGovernancePolicyService } from "../services/governance-policy.service.ts";
import { PullDestinationService } from "../services/pull-destination.service.ts";

class MemoryPolicyRepository extends CostAttributionPolicyRepository {
  constructor(private readonly configs: unknown[]) {
    super();
  }
  enabledCodingAssistantConfigs(): Promise<unknown[]> {
    return Promise.resolve(this.configs);
  }
}

describe("governance backend services", () => {
  it("composes Postgres policy over the Prisma repository", async () => {
    const policy = PostgresGovernancePolicyService.create(
      PrismaCostAttributionPolicyRepository.create({
        aiToolEntry: {
          findMany: async () => [{ config: { assistantKind: "codex", bundledPlan: false } }],
        },
      }),
    );

    await expect(
      policy.isSourceBilled({
        organizationId: "org",
        sourceType: "codex",
      }),
    ).resolves.toBe(true);
  });

  /** @scenario "A cost-attribution resolution is cached and an explicit billable tile is honored" */
  it("caches cost attribution and honors an explicit billable tile", async () => {
    const repository = new MemoryPolicyRepository([
      { assistantKind: "claude_code", bundledPlan: false },
    ]);
    const spy = vi.spyOn(repository, "enabledCodingAssistantConfigs");
    const service = PostgresGovernancePolicyService.create(repository, {
      clock: () => 1,
    });
    await expect(
      service.isSourceBilled({
        organizationId: "org",
        sourceType: "claude_code",
      }),
    ).resolves.toBe(true);
    await service.isSourceBilled({
      organizationId: "org",
      sourceType: "claude_code",
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("preserves department precedence", () => {
    const service = PostgresGovernancePolicyService.create(new MemoryPolicyRepository([]));
    expect(
      service.resolveTraceDepartment({
        hasPrincipalUser: true,
        userDepartmentId: null,
        userTeamDepartmentId: "team-department",
        projectDepartmentId: "project-department",
      }),
    ).toBe("team-department");
  });

  it("pins Databricks credentials to a workspace origin", () => {
    const service = PullDestinationService.create();
    expect(() =>
      service.assertAllowed({
        adapter: "databricks_genie",
        workspaceUrl: "https://tenant.azuredatabricks.net/",
      }),
    ).not.toThrow();
    expect(() =>
      service.assertAllowed({
        adapter: "databricks_genie",
        workspaceUrl: "https://attacker.test/",
      }),
    ).toThrow("Workspace URL");
  });

  it("extracts canonical OTLP cost events without importing OTLP runtime types", () => {
    const events = CanonicalCostExtractorService.create().extract({
      resourceLogs: [
        {
          resource: {
            attributes: [{ key: "langwatch.model", value: { stringValue: "gpt-5" } }],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: "1000000",
                  attributes: [
                    {
                      key: "langwatch.request_id",
                      value: { stringValue: "request" },
                    },
                    {
                      key: "langwatch.cost.usd",
                      value: { stringValue: "0.000000001" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(events).toEqual([
      expect.objectContaining({
        requestId: "request",
        model: "gpt-5",
        costUsd: "0.000000001",
        occurredAt: Temporal.Instant.fromEpochMilliseconds(1),
      }),
    ]);
  });
});
