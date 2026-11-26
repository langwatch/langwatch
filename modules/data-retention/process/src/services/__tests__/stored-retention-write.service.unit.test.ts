/**
 * @vitest-environment node
 * Every rewrite of a project's stored rows records the fact peers follow.
 * @see modules/data-retention/specs/data-retention-service.feature
 */
import type { RetentionAppliedToExistingDataEventData } from "@langwatch/data-retention-contract";
import { describe, expect, it } from "vitest";

import { StoredRetentionWriteService } from "../stored-retention-write.service.ts";

function writer() {
  const sent: RetentionAppliedToExistingDataEventData[] = [];
  const service = StoredRetentionWriteService.create({
    retention: {
      triggerRetroactiveUpdate: async () => ({ tables: ["stored_spans"] }),
      raiseStoredRetention: async () => ({ tables: ["stored_spans"], retentionDays: 90 }),
      applyStoredRetention: async () => ({ tables: ["stored_spans"], retentionDays: 14 }),
    },
  });
  service.connectFacts({
    recordRetentionAppliedToExistingData: {
      send: async (data) => {
        sent.push(data);
      },
    },
  });
  return { service, sent };
}

describe("StoredRetentionWriteService", () => {
  describe("when a project's stored rows are raised", () => {
    /** @scenario Raising or applying stored retention records the same fact */
    it("records the resolved days it raised them to", async () => {
      const { service, sent } = writer();

      await service.raiseStoredRetention({ projectId: "project-1", category: "traces" });

      expect(sent).toEqual([
        expect.objectContaining({
          projectId: "project-1",
          category: "traces",
          retentionDays: 90,
          mode: "raise",
        }),
      ]);
    });
  });

  describe("when a project's stored rows are rewritten to a shorter period", () => {
    /** @scenario Raising or applying stored retention records the same fact */
    it("records the resolved days it rewrote them to", async () => {
      const { service, sent } = writer();

      await service.applyStoredRetention({ projectId: "project-1", category: "traces" });

      expect(sent).toEqual([
        expect.objectContaining({ projectId: "project-1", category: "traces", retentionDays: 14 }),
      ]);
    });
  });

  describe("when the facts pipeline is not registered", () => {
    it("refuses before rewriting anything", async () => {
      const service = StoredRetentionWriteService.create({
        retention: {
          triggerRetroactiveUpdate: async () => {
            throw new Error("must not rewrite");
          },
          raiseStoredRetention: async () => {
            throw new Error("must not rewrite");
          },
          applyStoredRetention: async () => {
            throw new Error("must not rewrite");
          },
        },
      });

      await expect(
        service.raiseStoredRetention({ projectId: "project-1", category: "traces" }),
      ).rejects.toThrow("data_retention_facts is not registered");
    });
  });
});
