/**
 * The unbudgeted-spend sweep over in-memory stand-ins for its reads: which organizations it
 * records a fact for, and which keys a budget takes out of it.
 * @see modules/gateway/specs/gateway-governance-events.feature
 */
import type {
  GatewayBudgetResolutionTarget,
  RecordUnbudgetedSpendCommandData,
} from "@langwatch/gateway-contract";
import type { TraceDestinationProject } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { GatewayUnbudgetedSpendService } from "../../features/spend/services/gateway-unbudgeted-spend.service.ts";
import type { GatewayRecentlyUsedKey } from "../../repositories/gateway-virtual-key.repository.ts";

const NOW = Temporal.Instant.from("2026-11-25T10:00:00Z");
const USD = 1_000_000_000;

type SpendKey = GatewayRecentlyUsedKey & { spendUsd: number };

/** A budget applies to a target when this says so; enforcement's resolver stands behind it. */
type BudgetRule = (target: GatewayBudgetResolutionTarget) => boolean;

function sweepOver({
  keys,
  budgeted = () => false,
  failingOrganizations = [],
}: {
  keys: SpendKey[];
  budgeted?: BudgetRule;
  failingOrganizations?: string[];
}) {
  const recorded: Omit<RecordUnbudgetedSpendCommandData, "tenantId">[] = [];
  const windows: unknown[] = [];
  const projects: Record<string, TraceDestinationProject> = {
    "project-1": { id: "project-1", teamId: "team-1", archivedAt: null, kind: "default" },
  };
  const service = GatewayUnbudgetedSpendService.create({
    keys: {
      findLiveUsedSince: async ({ purpose, since }) => {
        expect(purpose).toBe("USER");
        expect(since).toEqual(Temporal.Instant.from("2026-11-19T00:00:00Z"));
        return keys.map(({ spendUsd: _spend, ...key }) => key);
      },
    },
    budgets: {
      listSpendTenantIds: async (organizationId) => {
        if (failingOrganizations.includes(organizationId)) throw new Error("ledger unreachable");
        return [`${organizationId}-project`];
      },
      resolveApplicableBudgets: async (target) =>
        budgeted(target) ? [{ budgetFor: target.virtualKeyId }] : [],
    },
    spend: {
      sumWindowByVirtualKey: async (window) => {
        windows.push(window);
        const organizationId = window.tenantIds[0]?.replace(/-project$/, "");
        return keys
          .filter((key) => key.organizationId === organizationId)
          .map((key) => ({ virtualKeyId: key.id, amountNanoUsd: key.spendUsd * USD }));
      },
    },
    projects: { findTraceDestination: async (projectId) => projects[projectId] ?? null },
    facts: { recordUnbudgetedSpend: async (fact) => void recorded.push(fact) },
    clock: () => NOW,
  });
  return { service, recorded, windows };
}

const spendKey = (overrides: Partial<SpendKey> & Pick<SpendKey, "id">): SpendKey => ({
  organizationId: "org-1",
  name: `${overrides.id} name`,
  principalUserId: null,
  traceProjectId: null,
  spendUsd: 10,
  ...overrides,
});

describe("GatewayUnbudgetedSpendService", () => {
  describe("when an organization's keys are budgeted by key, project, team or organization", () => {
    /** @scenario "A key any budget applies to is left out of unbudgeted spend" */
    it("names only the key no budget applies to, resolving each key's trace project", async () => {
      const { service, recorded } = sweepOver({
        keys: [
          spendKey({ id: "key-budgeted" }),
          spendKey({ id: "project-budgeted", traceProjectId: "project-1" }),
          spendKey({ id: "person-budgeted", principalUserId: "user-1" }),
          spendKey({ id: "free", spendUsd: 8 }),
        ],
        budgeted: (target) =>
          target.virtualKeyId === "key-budgeted" ||
          (target.projectId === "project-1" && target.teamId === "team-1") ||
          target.principalUserId === "user-1",
      });

      await service.sweep();

      expect(recorded).toEqual([
        expect.objectContaining({
          organization_id: "org-1",
          keys: [{ virtual_key_id: "free", name: "free name", spent_usd: "8" }],
          key_count: 1,
        }),
      ]);
    });

    /** @scenario "A key any budget applies to is left out of unbudgeted spend" */
    it("records nothing for an organization whose every key over the threshold is budgeted", async () => {
      const { service, recorded } = sweepOver({
        keys: [spendKey({ id: "a" }), spendKey({ id: "b", spendUsd: 3 })],
        budgeted: (target) => target.organizationId === "org-1" && target.virtualKeyId === "a",
      });

      await service.sweep();

      expect(recorded).toEqual([]);
    });
  });

  describe("when two organizations each have an unbudgeted key", () => {
    it("records one fact per organization over its own tenants and the seven-day window", async () => {
      const { service, recorded, windows } = sweepOver({
        keys: [spendKey({ id: "a" }), spendKey({ id: "b", organizationId: "org-2" })],
      });

      const report = await service.sweep();

      expect(recorded.map(({ organization_id }) => organization_id)).toEqual(["org-1", "org-2"]);
      expect(windows).toEqual([
        { tenantIds: ["org-1-project"], fromDay: "2026-11-19", toDay: "2026-11-25" },
        { tenantIds: ["org-2-project"], fromDay: "2026-11-19", toDay: "2026-11-25" },
      ]);
      expect(report).toEqual({ organizations: 2, recorded: 2, failed: 0 });
    });
  });

  describe("when one organization's reads fail", () => {
    /** @scenario "A key any budget applies to is left out of unbudgeted spend" */
    it("still records the others, and reports the failure", async () => {
      const { service, recorded } = sweepOver({
        keys: [spendKey({ id: "a" }), spendKey({ id: "b", organizationId: "org-2" })],
        failingOrganizations: ["org-1"],
      });

      const report = await service.sweep();

      expect(recorded.map(({ organization_id }) => organization_id)).toEqual(["org-2"]);
      expect(report).toEqual({ organizations: 2, recorded: 1, failed: 1 });
    });
  });
});
