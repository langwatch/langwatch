// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Batch inserts on the two governance stream repositories (ADR-075 Class
 * C, retired; ground now ADR-098). A replay rebuilds a window event by
 * event, so both projections write
 * through `bulkAppend` rather than issuing one INSERT per span.
 *
 * The interesting property is tenancy: the ClickHouse client is resolved
 * PER TENANT, so a batch that mixes tenants would have to pick one client
 * and write another tenant's audit rows through it. That is rejected, not
 * guessed at.
 *
 * Both repositories write through `@langwatch/clickhouse`'s positional
 * codec (ADR-104), so assertions here read the wire array by column
 * position rather than a JSON object's field names.
 */

import type { ClickHouseClient } from "@langwatch/clickhouse";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernanceKpiContribution } from "../governanceKpis.clickhouse.repository";
import { GovernanceKpisClickHouseRepository } from "../governanceKpis.clickhouse.repository";
import {
  type GovernanceOcsfEventInput,
  GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "../governanceOcsfEvents.clickhouse.repository";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const FAKE_NOW = "2026-01-01T00:00:00.000Z";
const WRITTEN_AT_WIRE = "2026-01-01 00:00:00.000";

function fakeClient() {
  const insert = vi.fn().mockResolvedValue(undefined);
  const resolveClient = vi
    .fn()
    .mockReturnValue({ insert } as unknown as ClickHouseClient);
  return { insert, resolveClient };
}

function kpiRow(
  overrides: Partial<GovernanceKpiContribution> = {},
): GovernanceKpiContribution {
  return {
    tenantId: "gov-project-1",
    sourceId: "is-1",
    sourceType: "claude_compliance",
    hourBucket: new Date(1_700_000_000_000),
    traceId: "aaaa0000000000000000000000000001",
    eventId: "bbbb0000000000a1",
    spendUsd: 1,
    promptTokens: 10,
    completionTokens: 5,
    lastEventOccurredAt: new Date(1_700_000_000_500),
    ...overrides,
  };
}

const KPI_COLUMN_NAMES = [
  "TenantId",
  "SourceId",
  "HourBucket",
  "TraceId",
  "EventId",
  "SourceType",
  "SpendUsd",
  "PromptTokens",
  "CompletionTokens",
  "CreatedAt",
  "LastEventOccurredAt",
];

const kpiRowWire = (
  overrides: Partial<{
    eventId: string;
    tenantId: string;
    lastEventOccurredAtWire: string;
  }> = {},
): unknown[] => [
  overrides.tenantId ?? "gov-project-1",
  "is-1",
  "2023-11-14 22:13:20",
  "aaaa0000000000000000000000000001",
  overrides.eventId ?? "bbbb0000000000a1",
  "claude_compliance",
  1,
  "10",
  "5",
  WRITTEN_AT_WIRE,
  overrides.lastEventOccurredAtWire ?? "2023-11-14 22:13:20.500",
];

function ocsfRow(
  overrides: Partial<GovernanceOcsfEventInput> = {},
): GovernanceOcsfEventInput {
  return {
    tenantId: "gov-project-1",
    eventId: "bbbb0000000000a1",
    traceId: "aaaa0000000000000000000000000001",
    sourceId: "is-1",
    sourceType: "claude_compliance",
    activityId: OCSF_ACTIVITY.INVOKE,
    severityId: OCSF_SEVERITY.INFO,
    eventTime: new Date(1_700_000_000_500),
    actorUserId: "user-42",
    actorEmail: "",
    actorEnduserId: "",
    actionName: "chat.completion",
    targetName: "claude-sonnet-4",
    anomalyAlertId: "",
    rawOcsfJson: "{}",
    ...overrides,
  };
}

const OCSF_COLUMN_NAMES = [
  "TenantId",
  "OcsfSchemaVersion",
  "EventId",
  "TraceId",
  "SourceId",
  "SourceType",
  "ClassUid",
  "CategoryUid",
  "ActivityId",
  "TypeUid",
  "SeverityId",
  "EventTime",
  "ActorUserId",
  "ActorEmail",
  "ActorEnduserId",
  "ActionName",
  "TargetName",
  "AnomalyAlertId",
  "RawOcsfJson",
  "CreatedAt",
  "LastUpdatedAt",
];

const ocsfRowWire = (
  overrides: Partial<{ eventId: string; tenantId: string }> = {},
): unknown[] => [
  overrides.tenantId ?? "gov-project-1",
  "1.1.0",
  overrides.eventId ?? "bbbb0000000000a1",
  "aaaa0000000000000000000000000001",
  "is-1",
  "claude_compliance",
  6003,
  6,
  6,
  600306,
  1,
  "2023-11-14 22:13:20.500",
  "user-42",
  "",
  "",
  "chat.completion",
  "claude-sonnet-4",
  "",
  "{}",
  WRITTEN_AT_WIRE,
  WRITTEN_AT_WIRE,
];

describe("GovernanceKpisClickHouseRepository.insertContributions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FAKE_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given rows that all belong to one tenant", () => {
    it("resolves that tenant's client once and writes every row in one insert", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceKpisClickHouseRepository(resolveClient);

      await repository.insertContributions([
        kpiRow({ eventId: "bbbb0000000000a1" }),
        kpiRow({ eventId: "bbbb0000000000a2" }),
      ]);

      expect(resolveClient).toHaveBeenCalledTimes(1);
      expect(resolveClient).toHaveBeenCalledWith("gov-project-1");
      expect(insert).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledWith({
        tenantId: "gov-project-1",
        table: "governance_kpis",
        rows: [
          kpiRowWire({ eventId: "bbbb0000000000a1" }),
          kpiRowWire({ eventId: "bbbb0000000000a2" }),
        ],
        columns: KPI_COLUMN_NAMES,
        target: { kind: "replacing" },
      });
    });

    /** @scenario governance_kpis's HourBucket and LastEventOccurredAt still encode to the same wire values */
    it("still encodes HourBucket and LastEventOccurredAt to the same wire strings as their old acceptedAt/writtenAt declarations did", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceKpisClickHouseRepository(resolveClient);

      await repository.insertContributions([kpiRow()]);

      const [row] = insert.mock.calls[0]![0].rows;
      expect(row[KPI_COLUMN_NAMES.indexOf("HourBucket")]).toBe(
        "2023-11-14 22:13:20",
      );
      expect(row[KPI_COLUMN_NAMES.indexOf("LastEventOccurredAt")]).toBe(
        "2023-11-14 22:13:20.500",
      );
    });

    it("sends the span id as EventId so migration 00063's key can dedup the row", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceKpisClickHouseRepository(resolveClient);

      await repository.insertContributions([
        kpiRow({ eventId: "bbbb0000000000a1" }),
      ]);

      const [row] = insert.mock.calls[0]![0].rows;
      expect(row[KPI_COLUMN_NAMES.indexOf("EventId")]).toBe("bbbb0000000000a1");
    });
  });

  describe("given a row written by a pre-ADR-075 caller with no event id", () => {
    it("sends the column's '' default so the row keeps deduping at trace grain", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceKpisClickHouseRepository(resolveClient);

      const { eventId: _dropped, ...withoutEventId } = kpiRow();
      await repository.insertContribution(withoutEventId);

      const [row] = insert.mock.calls[0]![0].rows;
      expect(row[KPI_COLUMN_NAMES.indexOf("EventId")]).toBe("");
    });
  });

  describe("given rows spanning more than one tenant", () => {
    it("refuses the batch rather than writing one tenant's rows through another's client", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceKpisClickHouseRepository(resolveClient);

      await expect(
        repository.insertContributions([
          kpiRow(),
          kpiRow({ tenantId: "gov-project-2" }),
        ]),
      ).rejects.toThrow(/one tenantId/);
      expect(insert).not.toHaveBeenCalled();
    });
  });

  describe("given an empty batch", () => {
    it("touches ClickHouse not at all", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceKpisClickHouseRepository(resolveClient);

      await repository.insertContributions([]);

      expect(resolveClient).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });
  });
});

describe("GovernanceOcsfEventsClickHouseRepository.insertEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FAKE_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given rows that all belong to one tenant", () => {
    it("writes every audit row in one insert", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceOcsfEventsClickHouseRepository(
        resolveClient,
      );

      await repository.insertEvents([
        ocsfRow({ eventId: "bbbb0000000000a1" }),
        ocsfRow({ eventId: "bbbb0000000000a2" }),
      ]);

      expect(insert).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledWith({
        tenantId: "gov-project-1",
        table: "governance_ocsf_events",
        rows: [
          ocsfRowWire({ eventId: "bbbb0000000000a1" }),
          ocsfRowWire({ eventId: "bbbb0000000000a2" }),
        ],
        columns: OCSF_COLUMN_NAMES,
        target: { kind: "replacing" },
      });
    });

    it("stamps LastUpdatedAt with one shared write instant per batch, so a re-derived row still supersedes the one it replaces", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceOcsfEventsClickHouseRepository(
        resolveClient,
      );

      await repository.insertEvents([ocsfRow()]);

      const [row] = insert.mock.calls[0]![0].rows;
      expect(row[OCSF_COLUMN_NAMES.indexOf("LastUpdatedAt")]).toBe(
        WRITTEN_AT_WIRE,
      );
    });
  });

  describe("given rows spanning more than one tenant", () => {
    it("refuses the batch rather than writing one tenant's audit rows through another's client", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceOcsfEventsClickHouseRepository(
        resolveClient,
      );

      await expect(
        repository.insertEvents([
          ocsfRow(),
          ocsfRow({ tenantId: "gov-project-2" }),
        ]),
      ).rejects.toThrow(/one tenantId/);
      expect(insert).not.toHaveBeenCalled();
    });
  });

  describe("given a row with no event id", () => {
    it("refuses it — an audit row with no identity cannot be deduped or rebuilt", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceOcsfEventsClickHouseRepository(
        resolveClient,
      );

      await expect(
        repository.insertEvents([ocsfRow({ eventId: "" })]),
      ).rejects.toThrow(/eventId are required/);
      expect(insert).not.toHaveBeenCalled();
    });
  });
});
