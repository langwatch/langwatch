/**
 * @vitest-environment node
 * The fact data-retention records after rewriting a project's existing rows.
 * @see modules/data-retention/specs/data-retention-service.feature
 */
import {
  DATA_RETENTION_PROJECT_AGGREGATE_TYPE,
  RETENTION_APPLIED_TO_EXISTING_DATA_EVENT_TYPE,
  type RetentionAppliedToExistingDataEventData,
} from "@langwatch/data-retention-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordRetentionAppliedToExistingDataCommand } from "../../eventing/data-retention-facts.commands.ts";
import {
  createDataRetentionTestApp,
  createDataRetentionTestEntitlement,
  retentionTestGraph,
} from "./data-retention.fixture.ts";

const caller = { userId: "user-1" };

function recordingFacts() {
  const sent: RetentionAppliedToExistingDataEventData[] = [];
  return {
    sent,
    senders: {
      recordRetentionAppliedToExistingData: {
        send: async (data: RetentionAppliedToExistingDataEventData) => {
          sent.push(data);
        },
      },
    },
  };
}

describe("applying retention to existing data", () => {
  describe("given the project's plan allows the rewrite", () => {
    /** @scenario Applying retention to existing data records a fact other modules can follow */
    it("records a fact naming the project, the category and the applied days", async () => {
      const app = createDataRetentionTestApp({ platformDefaultRetentionDays: 49 });
      const facts = recordingFacts();
      app.connectFacts(facts.senders);

      const result = await app.applyRetentionToExistingData({
        projectId: retentionTestGraph.projectId,
        category: "traces",
        ...caller,
      });

      expect(facts.sent).toEqual([
        expect.objectContaining({
          tenantId: retentionTestGraph.projectId,
          projectId: retentionTestGraph.projectId,
          category: "traces",
          retentionDays: result.appliedRetentionDays,
        }),
      ]);
    });
  });

  describe("given the rewrite is refused", () => {
    /** @scenario Applying retention to existing data records a fact other modules can follow */
    it("records no fact", async () => {
      const app = createDataRetentionTestApp({
        dependencies: {
          entitlement: createDataRetentionTestEntitlement({ free: true, type: "FREE" }),
        },
      });
      const facts = recordingFacts();
      app.connectFacts(facts.senders);

      await expect(
        app.applyRetentionToExistingData({
          projectId: retentionTestGraph.projectId,
          category: "traces",
          ...caller,
        }),
      ).rejects.toMatchObject({ code: expect.any(String) });
      expect(facts.sent).toEqual([]);
    });
  });

  describe("given the fact command is handled", () => {
    it("appends one fact on the project's aggregate, keyed by its instant, days and mode", () => {
      const data = {
        tenantId: "project-1",
        projectId: "project-1",
        category: "traces" as const,
        retentionDays: 7,
        occurredAt: 1_700_000_000_000,
      };

      const [event] = new RecordRetentionAppliedToExistingDataCommand().handle({
        tenantId: createTenantId("project-1"),
        aggregateId: "project-1",
        type: "lw.data_retention.record_retention_applied_to_existing_data",
        data,
      });

      expect(event).toMatchObject({
        aggregateType: DATA_RETENTION_PROJECT_AGGREGATE_TYPE,
        aggregateId: "project-1",
        type: RETENTION_APPLIED_TO_EXISTING_DATA_EVENT_TYPE,
        data,
        idempotencyKey: "project-1:traces:retention_applied:7:apply:1700000000000",
      });
    });

    /** @scenario "Two retention facts in the same millisecond are both recorded" */
    it("keys two changes in one millisecond apart, and a redelivery the same", () => {
      const keyOf = (data: RetentionAppliedToExistingDataEventData) =>
        new RecordRetentionAppliedToExistingDataCommand().handle({
          tenantId: createTenantId("project-1"),
          aggregateId: "project-1",
          type: "lw.data_retention.record_retention_applied_to_existing_data",
          data,
        })[0]?.idempotencyKey;
      const base = {
        tenantId: "project-1",
        projectId: "project-1",
        category: "traces" as const,
        occurredAt: 1_700_000_000_000,
      };

      expect(keyOf({ ...base, retentionDays: 7 })).not.toBe(keyOf({ ...base, retentionDays: 90 }));
      expect(keyOf({ ...base, retentionDays: 90 })).not.toBe(
        keyOf({ ...base, retentionDays: 90, mode: "raise" }),
      );
      expect(keyOf({ ...base, retentionDays: 7 })).toBe(keyOf({ ...base, retentionDays: 7 }));
    });
  });
});
