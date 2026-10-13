import type { RecordCodingAssistantBillingCommand } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it, vi } from "vitest";

import { CodingAssistantBillingFactService } from "../../features/cost/services/coding-assistant-billing-fact.service.ts";
import { MemoryCostAttributionPolicyRepository } from "../../repositories/memory/memory.cost-attribution-policy.repository.ts";

const AT = 1_760_000_000_000;

function world({
  seed,
  failing = false,
}: {
  seed: { organizationId: string; config: unknown; enabled?: boolean }[];
  failing?: boolean;
}) {
  const sent: RecordCodingAssistantBillingCommand[] = [];
  const batches: number[] = [];
  const policies = MemoryCostAttributionPolicyRepository.create({ seed });
  const facts = CodingAssistantBillingFactService.create({
    policies,
    organizationIds: async ({ after }) => {
      const ids = ["org-1", "org-2", "org-3"].filter((id) => after === undefined || id > after);
      return { ids, next: null };
    },
    clock: () => AT,
    record: async (command) => {
      if (failing) throw new Error("queue unavailable");
      sent.push(command);
    },
    recordMany: async (commands) => {
      if (failing) throw new Error("queue unavailable");
      batches.push(commands.length);
      sent.push(...commands);
    },
  });
  return { facts, sent, policies, batches };
}

function billedBySource(sent: RecordCodingAssistantBillingCommand[], organizationId: string) {
  return Object.fromEntries(
    sent
      .filter((command) => command.data.organizationId === organizationId)
      .map((command) => [command.data.sourceType, command.data.billed]),
  );
}

describe("CodingAssistantBillingFactService", () => {
  describe("when an organization's coding-assistant configs change", () => {
    /** @scenario "Governance records the billing fact when a coding-assistant config changes" */
    it("records one fact per assistant kind, billed only for an enabled config off a bundled plan", async () => {
      const { facts, sent } = world({
        seed: [
          { organizationId: "org-1", config: { assistantKind: "codex", bundledPlan: false } },
          { organizationId: "org-1", config: { assistantKind: "claude_code", bundledPlan: true } },
          { organizationId: "org-1", config: { assistantKind: "gemini" } },
        ],
      });

      await facts.recordForOrganization({ organizationId: "org-1" });

      expect(billedBySource(sent, "org-1")).toEqual({
        claude_code: false,
        codex: true,
        gemini: false,
        opencode: false,
        cursor: false,
        github_copilot: false,
        custom: false,
      });
      expect(sent.every((command) => command.tenantId === "org-1")).toBe(true);
      expect(sent.every((command) => command.data.recordedAtMs === AT)).toBe(true);
    });

    it("records the source as not billed when no config exists", async () => {
      const { facts, sent } = world({ seed: [] });

      await facts.recordForOrganization({ organizationId: "org-1" });

      expect(billedBySource(sent, "org-1").codex).toBe(false);
    });

    it("records the source as not billed when its config is disabled", async () => {
      const { facts, sent } = world({
        seed: [
          {
            organizationId: "org-1",
            config: { assistantKind: "codex", bundledPlan: false },
            enabled: false,
          },
        ],
      });

      await facts.recordForOrganization({ organizationId: "org-1" });

      expect(billedBySource(sent, "org-1").codex).toBe(false);
    });

    it("leaves the admin edit standing when the fact cannot be recorded", async () => {
      const { facts } = world({ seed: [], failing: true });

      await expect(facts.recordAfterChange({ organizationId: "org-1" })).resolves.toBeUndefined();
    });
  });

  describe("when the backfill runs", () => {
    /** @scenario "A backfill records the billing fact for configs written before it existed" */
    it("records facts for every organization, a page of ids at a time", async () => {
      const { facts, sent } = world({
        seed: [
          { organizationId: "org-1", config: { assistantKind: "codex", bundledPlan: false } },
          { organizationId: "org-2", config: { assistantKind: "cursor", bundledPlan: true } },
        ],
      });

      const totals = await facts.backfill();

      expect(totals).toEqual({ afterOrganizationId: "org-3", organizations: 3, recorded: 21 });
      expect(billedBySource(sent, "org-1").codex).toBe(true);
      expect(billedBySource(sent, "org-2").cursor).toBe(false);
    });
  });

  describe("when the backfill sweeps a thousand organizations", () => {
    /** @scenario "The billing backfill reads and records a slice of organizations at a time" */
    it("reads configs and sends commands once per hundred organizations, not once per organization", async () => {
      const ids = Array.from(
        { length: 1000 },
        (_, index) => `org-${String(index).padStart(4, "0")}`,
      );
      const policies = MemoryCostAttributionPolicyRepository.create({
        seed: [
          { organizationId: "org-0007", config: { assistantKind: "codex", bundledPlan: false } },
        ],
      });
      const singleReads = vi.spyOn(policies, "enabledCodingAssistantConfigs");
      const pageReads = vi.spyOn(policies, "findEnabledCodingAssistantConfigs");
      const batches: RecordCodingAssistantBillingCommand[][] = [];
      const facts = CodingAssistantBillingFactService.create({
        policies,
        organizationIds: async ({ after, limit }) => {
          const rest = ids.filter((id) => after === undefined || id > after);
          if (limit === undefined || rest.length <= limit) return { ids: rest, next: null };
          const page = rest.slice(0, limit);
          return { ids: page, next: page.at(-1) ?? null };
        },
        clock: () => AT,
        record: async () => {
          throw new Error("the backfill sends a slice at a time");
        },
        recordMany: async (commands) => {
          batches.push(commands);
        },
      });

      const totals = await facts.backfill();

      expect(totals.organizations).toBe(1000);
      expect(singleReads).not.toHaveBeenCalled();
      expect(pageReads).toHaveBeenCalledTimes(10);
      expect(batches).toHaveLength(10);
      const sent = batches.flat();
      expect(totals.recorded).toBe(sent.length);
      expect(billedBySource(sent, "org-0007").codex).toBe(true);
      expect(billedBySource(sent, "org-0008").codex).toBe(false);
    });
  });
});
