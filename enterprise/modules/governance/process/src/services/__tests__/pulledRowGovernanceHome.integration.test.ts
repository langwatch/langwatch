// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Where a pulled provider cost row lives, and whose money it is (ADR-128): the home is the
 * organization's governance project, which project owns; the owner is the source's team.
 * Spec: specs/governance/pulled-rows-home-and-leak-gate.feature
 */
import {
  governanceIngestionSourceSchema,
  type NormalizedPullEvent,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { createWorkerService } from "../../__tests__/support/puller-test-ports.ts";
import { PulledUsageLedgerProcess } from "../../eventing/pulled-usage-ledger.process.ts";

const HOME = "proj_governance_home";

const SOURCE = governanceIngestionSourceSchema.parse({
  id: "src_home",
  organizationId: "org_home",
  teamId: "team_home",
  sourceType: "anthropic_admin",
  status: "active",
  parserConfig: { adapter: "test_adapter" },
  pollerCursor: null,
  name: "home source",
  description: null,
  ingestSecretHash: "hash",
  errorCount: 0,
  pullSchedule: null,
  lastEventAt: null,
  archivedAt: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  createdById: null,
});

const usageEvent: NormalizedPullEvent = {
  source_event_id: "usage:2026-08-01:ws_1",
  event_timestamp: "2026-08-01T00:00:00.000Z",
  actor: "",
  action: "usage_report",
  target: "anthropic/claude-sonnet-5",
  cost_usd: "0",
  tokens_input: 1_000,
  tokens_output: 100,
  raw_payload: "{}",
  extra: {
    pulled_usage: {
      costBasis: "computed",
      dimensions: { workspaceId: "ws_1", granularity: "1d" },
      model: "anthropic/claude-sonnet-5",
    },
  },
};

function pull() {
  const asked: { organizationId: string; kind: string }[] = [];
  const recordPulledUsage = vi.fn().mockResolvedValue(undefined);
  const worker = createWorkerService({
    source: SOURCE,
    adapter: {
      id: "test_adapter",
      validateConfig: (config: unknown) => config,
      runOnce: async () => ({ events: [usageEvent], cursor: null, errorCount: 0 }),
    },
    insertEvent: async () => undefined,
    usageEnabled: async () => true,
    ensureProject: async (input) => {
      asked.push(input);
      return { id: HOME };
    },
  });
  return {
    asked,
    recordPulledUsage,
    run: () =>
      worker.run({ sourceId: SOURCE.id, cursor: null, pulledUsage: { recordPulledUsage } }),
  };
}

describe("a pulled usage record arriving from a provider source", () => {
  describe("given an organization with a connected provider source", () => {
    /** @scenario "A pulled row gets the organization's governance home on arrival" */
    it("stores the row under the governance home and attributes the money to the source's team", async () => {
      const { run, recordPulledUsage } = pull();

      await run();

      const record = recordPulledUsage.mock.calls[0]![0];
      expect(record.projectId).toBe(HOME);
      expect(record.organizationId).toBe("org_home");
      expect(record.teamId).toBe("team_home");
      expect(PulledUsageLedgerProcess.scopeId(record)).toBe("team_home");
      expect(PulledUsageLedgerProcess.scopeId(record)).not.toBe(HOME);
    });

    /** @scenario "The organization has exactly one governance home, created when absent" */
    it("asks project for the organization's one governance home on every pull, never minting its own", async () => {
      const { run, asked } = pull();

      await run();
      await run();

      expect(asked).toEqual([
        { organizationId: "org_home", kind: PROJECT_KIND.INTERNAL_GOVERNANCE },
        { organizationId: "org_home", kind: PROJECT_KIND.INTERNAL_GOVERNANCE },
      ]);
    });
  });
});
