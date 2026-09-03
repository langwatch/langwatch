// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A destination project column on an ingestion source only means something
 * for a source whose events are conversations. A counts-pulling source (usage
 * & cost totals, no message content) can carry the same column — nothing on
 * the way in refuses it — but routing those totals as though someone had
 * said them would render billing rows as messages nobody spoke.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import { describe, expect, it } from "vitest";
import { governanceIngestionSourceSchema } from "@langwatch/enterprise-governance-contract";
import { createWorkerService } from "../../__tests__/support/puller-test-ports";

function countsPullingSource() {
  return governanceIngestionSourceSchema.parse({
    id: "src-anthropic-admin-1",
    organizationId: "org-1",
    teamId: null,
    // A destination project stored on it, which its own drawer never
    // offered and nothing on the way in refused.
    traceProjectId: "proj-analytics",
    sourceType: "anthropic_admin",
    name: "Anthropic Admin API (usage & cost)",
    description: null,
    ingestSecretHash: "hash",
    parserConfig: { adapter: "anthropic_admin", credentials: {} },
    pollerCursor: null,
    errorCount: 0,
    pullSchedule: null,
    status: "active",
    lastEventAt: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    createdById: null,
  });
}

describe("given an Anthropic Admin API source with a destination project", () => {
  describe("when a run pulls its usage and cost totals", () => {
    /** @scenario A counts-pulling source with a destination still routes nothing */
    it("routes nothing, because none of those totals is a conversation", async () => {
      const service = createWorkerService({
        source: countsPullingSource(),
        adapter: {
          id: "anthropic_admin",
          validateConfig: (config) => config,
          runOnce: async () => ({
            events: [
              {
                source_event_id: "usage-1",
                event_timestamp: "2026-08-20T10:00:00.000Z",
                actor: "acme-workspace",
                action: "usage_total",
                target: "claude-opus",
                cost_usd: "12.50",
                tokens_input: 40_000,
                tokens_output: 2_000,
                raw_payload: JSON.stringify({ workspace: "acme" }),
              },
            ],
            cursor: "cursor-1",
            errorCount: 0,
          }),
        },
        insertEvent: async () => {},
        usageEnabled: async () => false,
        ensureProject: async () => ({ id: "proj-analytics" }),
      });

      // No `traceIngestion` port is wired into this double: if routing were
      // ever attempted for a counts-only source, `routeConversations` would
      // throw "Conversation trace ingestion is not composed" rather than
      // silently pretending to route. A resolved run proves nothing tried.
      await expect(
        service.run({ sourceId: "src-anthropic-admin-1", cursor: null }),
      ).resolves.toMatchObject({ nextCursor: "cursor-1", eventCount: 1 });
    });
  });
});
