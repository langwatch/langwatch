import { describe, expect, it } from "vitest";
import {
  simulationRunMessagesTable,
  simulationRunsTable,
} from "../table";

/**
 * @see specs/event-sourcing/simulation-run-aggregate.feature
 */
describe("simulationRunsTable", () => {
  it("declares the deployed engine key and replacing version", () => {
    expect(simulationRunsTable.sortKey).toEqual(["TenantId", "ScenarioRunId"]);
    expect(simulationRunsTable.merge).toEqual({
      kind: "replacing",
      version: "UpdatedAt",
    });
  });

  it("declares no delivery-sequence column", () => {
    expect(simulationRunsTable.columnNames).not.toContain("DeliverySeq");
  });

  it("holds nothing that grows with the run's work", () => {
    for (const column of [
      "Messages.Id",
      "Messages.Role",
      "Messages.Content",
      "Messages.TraceId",
      "Messages.Rest",
      "LastSnapshotOccurredAt",
    ]) {
      expect(simulationRunsTable.columnNames).not.toContain(column);
    }
  });
});

describe("simulationRunMessagesTable", () => {
  it("keys a row by the logical message, so a redelivery collapses at merge", () => {
    expect(simulationRunMessagesTable.sortKey).toEqual([
      "TenantId",
      "ScenarioRunId",
      "MessageId",
    ]);
    expect(simulationRunMessagesTable.merge).toEqual({
      kind: "replacing",
      version: "UpdatedAt",
    });
  });

  it("partitions on a platform-stamped anchor, never on the message's own time", () => {
    expect(simulationRunMessagesTable.partition).toEqual({
      by: "toYearWeek(AcceptedAt)",
      column: "AcceptedAt",
    });
  });
});
