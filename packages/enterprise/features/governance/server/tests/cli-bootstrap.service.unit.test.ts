import { describe, expect, it, vi } from "vitest";
import { PLATFORM_TOOL_POLICY_DEFAULTS } from "@langwatch/enterprise-governance-contract";
import {
  CliAdminContactPort,
  CliBudgetOverviewPort,
} from "../src/ports/cli-bootstrap.port";
import { DefaultGovernanceCliBootstrapService } from "../src/services/cli-bootstrap.service";

class MemoryCatalog {
  listForUser = vi.fn();
  listForAdmin = vi.fn();
  tryFindById = vi.fn();
  create = vi.fn();
  update = vi.fn();
  remove = vi.fn();
  ensureDefaultCatalog = vi.fn();
  seedStarterPack = vi.fn();
  listConfiguredProvidersForUser = vi.fn();
  listProviderOptionsForAdmin = vi.fn();
  listRoutingPolicyOptionsForAdmin = vi.fn();
  reorder = vi.fn();
  resolveToolPolicyOverrides = vi.fn();
  resolveToolPolicy = vi.fn();
  resolveToolPolicyMap = vi.fn(async () => PLATFORM_TOOL_POLICY_DEFAULTS);
  resolveCliCatalogForUser = vi.fn(async () => ({
    tools: [{ slug: "claude", displayName: "Claude Code" }],
    providers: [{ providerKey: "anthropic", displayName: "Anthropic", configured: true }],
    configuredProviderKeys: ["anthropic"],
  }));
}

class MemoryBudgets extends CliBudgetOverviewPort {
  overviewForUser = vi.fn(async () => ({
    gatewayAccess: true,
    budgets: [{ window: "MONTH", limitUsd: "25", spentUsd: "4.5" }],
  }));
}

class MemoryContacts extends CliAdminContactPort {
  tryResolveAdminEmail = vi.fn(async () => "admin@example.com");
}

describe("DefaultGovernanceCliBootstrapService", () => {
  it("builds one portable login ceremony from injected capabilities", async () => {
    const service = DefaultGovernanceCliBootstrapService.create({
      catalog: new MemoryCatalog(),
      budgets: new MemoryBudgets(),
      contacts: new MemoryContacts(),
      gatewayUrl: "https://gateway.example.com",
    });
    const result = await service.resolve({
      userId: "user",
      organizationId: "organization",
    });
    expect(result.providers).toEqual([
      { name: "anthropic", displayName: "Anthropic", configured: true },
    ]);
    expect(result.budget).toEqual({
      monthlyLimitUsd: 25,
      monthlyUsedUsd: 4.5,
      period: "MONTHLY",
    });
    expect(result.adminEmail).toBe("admin@example.com");
  });
});
