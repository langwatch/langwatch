// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Batch inserts on the two governance stream repositories (ADR-075 Class
 * C). A replay rebuilds a window event by event, so both projections write
 * through `bulkAppend` rather than issuing one INSERT per span.
 *
 * The interesting property is tenancy: the ClickHouse client is resolved
 * PER TENANT, so a batch that mixes tenants would have to pick one client
 * and write another tenant's audit rows through it. That is rejected, not
 * guessed at.
 */

import { describe, expect, it, vi } from "vitest";
import { GovernanceKpisClickHouseRepository } from "../governanceKpis.clickhouse.repository";
import {
  type GovernanceOcsfEventInput,
  GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "../governanceOcsfEvents.clickhouse.repository";
import type { GovernanceKpiContribution } from "../governanceKpis.clickhouse.repository";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function fakeClient() {
  const insert = vi.fn().mockResolvedValue(undefined);
  const resolveClient = vi.fn().mockResolvedValue({ insert });
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

describe("GovernanceKpisClickHouseRepository.insertContributions", () => {
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
      expect(insert.mock.calls[0]![0].values).toHaveLength(2);
    });

    it("sends the span id as EventId so migration 00063's key can dedup the row", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceKpisClickHouseRepository(resolveClient);

      await repository.insertContributions([
        kpiRow({ eventId: "bbbb0000000000a1" }),
      ]);

      expect(insert.mock.calls[0]![0].values[0].EventId).toBe(
        "bbbb0000000000a1",
      );
    });
  });

  describe("given a row written by a pre-ADR-075 caller with no event id", () => {
    it("sends the column's '' default so the row keeps deduping at trace grain", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceKpisClickHouseRepository(resolveClient);

      const { eventId: _dropped, ...withoutEventId } = kpiRow();
      await repository.insertContribution(withoutEventId);

      expect(insert.mock.calls[0]![0].values[0].EventId).toBe("");
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
      expect(insert.mock.calls[0]![0].values).toHaveLength(2);
    });

    it("leaves LastUpdatedAt to the column default, so a re-derived row supersedes the one it re-derives", async () => {
      const { insert, resolveClient } = fakeClient();
      const repository = new GovernanceOcsfEventsClickHouseRepository(
        resolveClient,
      );

      await repository.insertEvents([ocsfRow()]);

      expect(insert.mock.calls[0]![0].values[0]).not.toHaveProperty(
        "LastUpdatedAt",
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
