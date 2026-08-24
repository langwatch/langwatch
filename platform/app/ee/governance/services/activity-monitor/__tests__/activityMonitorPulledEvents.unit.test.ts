import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("~/server/app-layer/app", () => {
  const app = () => ({
    clickhouse: {
      enabled: true,
      resolveClient: async () => {
        throw new Error("no tenant client in this suite");
      },
      resolveOrganizationClient: vi.fn(async () => ({ query })),
      allInstances: async () => [],
    },
  });
  return { getApp: app, tryGetApp: app };
});

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
        costUsd: "0.0042",
        tokensInput: 8,
        tokensOutput: 5,
      }),
    );
  });

  it("reads 0 for usage fields an adapter's extra made non-numeric", async () => {
    // `mapToOcsfRow` spreads the adapter's `extra` over the three usage fields
    // it just wrote, and `extra` is typed `z.record(z.unknown())` — so an
    // adapter can land any JSON where a number belongs. Reading it back with a
    // bare `Number(...)` yields NaN and puts NaN on the dashboard.
    const pulledRow = (eventId: string, extension: unknown) => ({
      eventId,
      eventType: "anthropic_admin",
      actorUserId: "",
      actorEmail: "pulled@example.com",
      actorEnduserId: "",
      action: "usage_report",
      target: "claude-haiku-4-5",
      occurredMs: "1786619820000",
      createdMs: "1786619821000",
      rawPayload: JSON.stringify({ metadata: { extension } }),
    });

    query.mockImplementation(async ({ query: sql }: { query: string }) => ({
      json: async () =>
        sql.includes("governance_ocsf_events")
          ? [
              pulledRow("poisoned-fields", {
                cost_usd: "not-a-number",
                tokens_input: { nested: true },
                tokens_output: 5,
              }),
              pulledRow("poisoned-extension", "not-an-object"),
            ]
          : [],
    }));

    const prisma = {
      project: { findFirst: vi.fn(async () => ({ id: "gov-project" })) },
    };
    const service = ActivityMonitorService.create(prisma as never);

    const rows = await service.eventsForSource({
      organizationId: "org",
      sourceId: "source",
      limit: 50,
    });

    const byId = new Map(rows.map((row) => [row.eventId, row]));
    // The one field that was a number survives; only the bad two fall back.
    expect(byId.get("poisoned-fields")).toEqual(
      expect.objectContaining({
        costUsd: "0",
        tokensInput: 0,
        tokensOutput: 5,
      }),
    );
    expect(byId.get("poisoned-extension")).toEqual(
      expect.objectContaining({
        costUsd: "0",
        tokensInput: 0,
        tokensOutput: 0,
      }),
    );
  });

  it("shows a negative reported cost rather than zeroing it", async () => {
    // The HTTP and S3 pollers resolve `cost_usd` from a customer-configured
    // JSONPath, so a credit or adjustment line lands here verbatim. This view
    // renders the stored OCSF row — the audit record — and must not show 0 for
    // a figure the row plainly contains.
    query.mockImplementation(async ({ query: sql }: { query: string }) => ({
      json: async () =>
        sql.includes("governance_ocsf_events")
          ? [
              {
                eventId: "credit-line",
                eventType: "http_polling",
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
                      cost_usd: -12.5,
                      tokens_input: 8,
                      tokens_output: 5,
                    },
                  },
                }),
              },
            ]
          : [],
    }));

    const prisma = {
      project: { findFirst: vi.fn(async () => ({ id: "gov-project" })) },
    };
    const service = ActivityMonitorService.create(prisma as never);

    const rows = await service.eventsForSource({
      organizationId: "org",
      sourceId: "source",
      limit: 50,
    });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        eventId: "credit-line",
        costUsd: "-12.5",
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

  it("returns only internally consistent email delivery statuses", async () => {
    const timestamp = "2026-08-24T07:22:00.000Z";
    const statuses = [
      {
        status: "accepted",
        acceptedCount: 2,
        failedCount: 0,
        totalCount: 2,
        updatedAtIso: timestamp,
      },
      {
        status: "partial_failure",
        acceptedCount: 1,
        failedCount: 1,
        totalCount: 2,
        updatedAtIso: timestamp,
      },
      {
        status: "failed",
        acceptedCount: 0,
        failedCount: 2,
        totalCount: 2,
        updatedAtIso: timestamp,
      },
      {
        status: "partial_failure",
        acceptedCount: 2,
        failedCount: 0,
        totalCount: 2,
        updatedAtIso: timestamp,
      },
      {
        status: "accepted",
        acceptedCount: 1,
        failedCount: 0,
        totalCount: 2,
        updatedAtIso: timestamp,
      },
      {
        status: "failed",
        acceptedCount: -1,
        failedCount: 2,
        totalCount: 1,
        updatedAtIso: timestamp,
      },
      {
        status: "accepted",
        acceptedCount: 1.5,
        failedCount: 0,
        totalCount: 1.5,
        updatedAtIso: timestamp,
      },
      {
        status: "accepted",
        acceptedCount: Number.POSITIVE_INFINITY,
        failedCount: 0,
        totalCount: Number.POSITIVE_INFINITY,
        updatedAtIso: timestamp,
      },
      {
        status: "accepted",
        acceptedCount: 1,
        failedCount: 0,
        totalCount: 1,
        updatedAtIso: "not-a-date",
      },
    ];
    const date = new Date(timestamp);
    const prisma = {
      anomalyAlert: {
        findMany: vi.fn(async () =>
          statuses.map((email, index) => ({
            id: `alert-${index}`,
            ruleId: "rule",
            ruleName: "Rule",
            ruleType: "spend_spike",
            severity: "warning",
            triggerWindowStart: date,
            triggerWindowEnd: date,
            triggerSpendUsd: null,
            triggerEventCount: null,
            detectedAt: date,
            state: "open",
            detail: {},
            destinationStatus: { email },
          })),
        ),
      },
    };
    const service = ActivityMonitorService.create(prisma as never);

    const rows = await service.recentAnomalies({ organizationId: "org" });

    expect(rows.slice(0, 3).map((row) => row.emailDeliveryStatus)).toEqual(
      statuses.slice(0, 3),
    );
    expect(rows.slice(3).every((row) => row.emailDeliveryStatus === null)).toBe(
      true,
    );
  });
});
