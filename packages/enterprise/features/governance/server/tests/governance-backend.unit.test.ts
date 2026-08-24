import { describe, expect, it, vi } from "vitest";
import { PostgresGovernanceAdapter } from "../src/adapters/postgres.governance.adapter";
import { GovernanceEncryptionPort } from "../src/ports/governance-encryption.port";
import { CostAttributionPolicyRepository } from "../src/repositories/cost-attribution-policy.repository";
import { CanonicalCostExtractorService } from "../src/services/canonical-cost-extractor.service";
import { PostgresGovernancePolicyService } from "../src/services/governance-policy.service";
import { IngestionCredentialsService } from "../src/services/ingestion-credentials.service";
import { PullDestinationService } from "../src/services/pull-destination.service";

class MemoryPolicyRepository extends CostAttributionPolicyRepository {
  constructor(private readonly configs: unknown[]) {
    super();
  }
  enabledCodingAssistantConfigs(): Promise<unknown[]> {
    return Promise.resolve(this.configs);
  }
}

class ReversibleEncryption extends GovernanceEncryptionPort {
  encrypt(plaintext: string): string {
    return [...plaintext].reverse().join("");
  }
  decrypt(ciphertext: string): string {
    return [...ciphertext].reverse().join("");
  }
}

describe("governance backend services", () => {
  it("composes Postgres policy behind one public adapter", async () => {
    const adapter = PostgresGovernanceAdapter.create({
      database: {
        aiToolEntry: {
          findMany: async () => [
            { config: { assistantKind: "codex", bundledPlan: false } },
          ],
        },
      },
    });

    await expect(
      adapter.build().policy.resolveSourceNonBillable({
        organizationId: "org",
        sourceType: "codex",
      }),
    ).resolves.toBe(false);
  });

  it("caches cost attribution and honors an explicit billable tile", async () => {
    const repository = new MemoryPolicyRepository([
      { assistantKind: "claude_code", bundledPlan: false },
    ]);
    const spy = vi.spyOn(repository, "enabledCodingAssistantConfigs");
    const service = PostgresGovernancePolicyService.create(repository, {
      clock: () => 1,
    });
    await expect(
      service.resolveSourceNonBillable({
        organizationId: "org",
        sourceType: "claude_code",
      }),
    ).resolves.toBe(false);
    await service.resolveSourceNonBillable({
      organizationId: "org",
      sourceType: "claude_code",
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("preserves department precedence", () => {
    const service = PostgresGovernancePolicyService.create(
      new MemoryPolicyRepository([]),
    );
    expect(
      service.resolveTraceDepartment({
        hasPrincipalUser: true,
        userDepartmentId: null,
        userTeamDepartmentId: "team-department",
        projectDepartmentId: "project-department",
      }),
    ).toBe("team-department");
  });

  it("encrypts only the credential subtree and tolerates legacy plaintext", () => {
    const service = IngestionCredentialsService.create(
      new ReversibleEncryption(),
    );
    const sealed = service.encryptParserConfig({
      adapter: "http_polling",
      credentials: { token: "secret" },
    });
    expect(sealed?.adapter).toBe("http_polling");
    expect(service.decrypt(sealed?.credentials)).toEqual({ token: "secret" });
    expect(service.decrypt({ token: "legacy" })).toEqual({ token: "legacy" });
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
            attributes: [
              { key: "langwatch.model", value: { stringValue: "gpt-5" } },
            ],
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
        occurredAt: new Date(1),
      }),
    ]);
  });
});
