// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The match seam: a pull that discovers people hands the organization to the
 * identity-match member, after the run's own writes (ADR-128 §12).
 * Spec: specs/governance/governance-people-screen.feature
 */
import {
  governanceIngestionSourceSchema,
  type NormalizedPullEvent,
} from "@langwatch/enterprise-governance-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkerService } from "../../__tests__/support/puller-test-ports.ts";

const insertEvent = vi.fn();
const recordFromPulledEvents = vi.fn();

const SOURCE = governanceIngestionSourceSchema.parse({
  id: "src_1",
  organizationId: "org_acme",
  teamId: "team_platform",
  sourceType: "anthropic_admin",
  status: "active",
  parserConfig: { adapter: "test_adapter" },
  pollerCursor: null,
  name: "test source",
  description: null,
  ingestSecretHash: "hash",
  errorCount: 0,
  pullSchedule: null,
  lastEventAt: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  createdById: null,
});

const pulledEvent: NormalizedPullEvent = {
  source_event_id: "evt_1",
  event_timestamp: "2026-08-01T00:00:00.000Z",
  actor: "casey@example-provider.test",
  action: "invoke",
  target: "anthropic/claude-sonnet-5",
  cost_usd: "0",
  tokens_input: 1,
  tokens_output: 1,
  raw_payload: "{}",
  extra: {},
};

function runPull(identityMatch: { runFor(input: { organizationId: string }): Promise<void> }) {
  return createWorkerService({
    source: SOURCE,
    adapter: {
      id: "test_adapter",
      validateConfig: (config: unknown) => config,
      runOnce: async () => ({ events: [pulledEvent], cursor: null, errorCount: 0 }),
    },
    insertEvent: async (row) => insertEvent(row),
    usageEnabled: async () => false,
    ensureProject: async () => ({ id: "proj_governance" }),
    discovery: { recordFromPulledEvents: () => recordFromPulledEvents() },
    identityMatch,
  }).run({ sourceId: "src_1", cursor: null });
}

beforeEach(() => {
  insertEvent.mockReset().mockResolvedValue(undefined);
  recordFromPulledEvents.mockReset().mockResolvedValue({ discovered: 1 });
});

describe("the pull run's identity-match seam", () => {
  describe("when a delivery discovers at least one person", () => {
    /** @scenario "Suggestions are recomputed when the feed discovers people" */
    it("hands the organization to the matcher, once, after the delivery's own writes", async () => {
      const runFor = vi.fn().mockResolvedValue(undefined);

      await runPull({ runFor });

      expect(runFor).toHaveBeenCalledExactlyOnceWith({ organizationId: "org_acme" });
      expect(insertEvent.mock.invocationCallOrder[0]).toBeLessThan(
        runFor.mock.invocationCallOrder[0]!,
      );
    });

    it("still delivers the run when the matcher throws", async () => {
      const runFor = vi.fn().mockRejectedValue(new Error("scorer fell over"));

      await expect(runPull({ runFor })).resolves.toMatchObject({ eventCount: 1, errorCount: 0 });
    });
  });

  describe("when the delivery discovers nobody", () => {
    it("never invokes the matcher, because an empty feed is not a trigger", async () => {
      recordFromPulledEvents.mockResolvedValue({ discovered: 0 });
      const runFor = vi.fn();

      await runPull({ runFor });

      expect(runFor).not.toHaveBeenCalled();
    });
  });
});
