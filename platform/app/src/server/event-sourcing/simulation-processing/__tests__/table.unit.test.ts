import { describe, expect, it } from "vitest";
import { simulationRunMessagesTable, simulationRunsTable } from "../table";

/**
 * @see specs/event-sourcing/simulation-run-aggregate.feature
 */
/** Migration parity — engine, keys, anchors, column types — is asserted against
 *  the migration SQL in `../../__tests__/tableMigrationParity.unit.test.ts`. */
describe("simulationRunsTable", () => {
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

/** No migration creates this table yet, which the parity test asserts. */
describe("simulationRunMessagesTable", () => {
  it("keys a row by the logical message, so a redelivery collapses at merge", () => {
    expect(simulationRunMessagesTable.sortKey.at(-1)).toBe("MessageId");
  });

  it("anchors on a platform stamp, so a new table starts free of ADR-099 debt", () => {
    expect(
      simulationRunMessagesTable.columns[
        simulationRunMessagesTable.partition.column
      ]?.timeRole,
    ).toBe("acceptedAt");
    expect(simulationRunMessagesTable.structuralDebt).toBeUndefined();
  });
});
