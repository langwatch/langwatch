import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForOrganization: vi.fn(async () => ({ query })),
}));

import { ActivityMonitorService } from "../activityMonitor.service";

describe("ActivityMonitorService pulled and pushed source events", () => {
  beforeEach(() => {
    query.mockReset();
    query.mockImplementation(async ({ query: sql }: { query: string }) => ({
      json: async () => {
        if (sql.includes("countIf")) {
          if (sql.includes("governance_ocsf_events")) {
            return [{ c24: "3", c7: "3", c30: "3", lastMs: "3000" }];
          }
          if (sql.includes("stored_log_records")) {
            return [{ c24: "1", c7: "1", c30: "1", lastMs: "2000" }];
          }
          return [{ c24: "2", c7: "2", c30: "2", lastMs: "1000" }];
        }
        return sql.includes("governance_ocsf_events")
          ? [
              {
                eventId: "pulled-event",
                eventType: "anthropic_admin",
                actorUserId: "",
                actorEmail: "pulled@example.com",
                actorEnduserId: "",
                action: "usage_report",
                target: "claude-haiku-4-5",
                occurredMs: "1786619820000",
                createdMs: "1786619821000",
                rawPayload: JSON.stringify({
                  metadata: {
                    extension: {
                      cost_usd: 0.0042,
                      tokens_input: 8,
                      tokens_output: 5,
                    },
                  },
                }),
              },
            ]
          : [
              {
                eventId: "pushed-trace",
                eventType: "otel_generic",
                actor: "push@example.com",
                target: "gpt-5",
                costUsd: 0.01,
                tokensInput: 10,
                tokensOutput: 4,
                occurredMs: "1786619810000",
                createdMs: "1786619811000",
              },
            ];
      },
    }));
  });

  it("returns pulled OCSF events and pushed traces in one newest-first list", async () => {
    const prisma = {
      project: { findFirst: vi.fn(async () => ({ id: "gov-project" })) },
    };
    const service = ActivityMonitorService.create(prisma as never);

    const rows = await service.eventsForSource({
      organizationId: "org",
      sourceId: "source",
      limit: 50,
    });

    expect(rows.map((row) => row.eventId)).toEqual([
      "pulled-event",
      "pushed-trace",
    ]);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        eventType: "anthropic_admin",
        actor: "pulled@example.com",
        action: "usage_report",
        target: "claude-haiku-4-5",
        costUsd: 0.0042,
        tokensInput: 8,
        tokensOutput: 5,
      }),
    );
  });

  it("includes pulled OCSF events in source health counts and last event", async () => {
    const prisma = {
      project: { findFirst: vi.fn(async () => ({ id: "gov-project" })) },
    };
    const service = ActivityMonitorService.create(prisma as never);

    const metrics = await service.sourceHealthMetrics({
      organizationId: "org",
      sourceId: "source",
    });

    expect(metrics).toEqual({
      events24h: 6,
      events7d: 6,
      events30d: 6,
      lastSuccessIso: new Date(3000).toISOString(),
    });
  });
});
