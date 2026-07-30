import { createRowCodec } from "@langwatch/clickhouse";
import { describe, expect, it } from "vitest";
import { codingAgentSessionsTable } from "../table";

/** Migration parity — engine, keys, anchors, column types — is asserted against
 *  the migration SQL in `../../__tests__/tableMigrationParity.unit.test.ts`. */
describe("coding_agent_sessions", () => {
  describe("given the two Array(Tuple(...)) columns 00051 and 00053 deployed", () => {
    it("carries a tuple array over the wire, not a JSON string", () => {
      const steps = codingAgentSessionsTable.columns.Steps;
      expect(steps.encode([["Read", 3, false]])).toEqual([["Read", 3, false]]);
      expect(steps.decode([["Read", 3, false]])).toEqual([["Read", 3, false]]);

      const series = codingAgentSessionsTable.columns.MetricSeries;
      const unit = ["s1", "lines_changed", "edit", "accept", "ts", 12.5];
      expect(series.encode([unit])).toEqual([unit]);
      expect(series.decode([unit])).toEqual([unit]);
    });

    it("refuses a JSON string, which is what the previous declaration wrote", () => {
      expect(() =>
        codingAgentSessionsTable.columns.Steps.decode('[["Read",3,false]]'),
      ).toThrow();
    });

    it("refuses a tuple of the wrong arity or element type", () => {
      expect(() =>
        codingAgentSessionsTable.columns.Steps.decode([["Read", 3]]),
      ).toThrow();
      expect(() =>
        codingAgentSessionsTable.columns.Steps.decode([["Read", 3, "no"]]),
      ).toThrow();
    });
  });

  it("round-trips both columns through the shared positional codec", () => {
    const codec = createRowCodec();
    const columns = ["Steps", "MetricSeries"] as const;
    const wire = columns.map((name) => codingAgentSessionsTable.columns[name]);
    const row = {
      Steps: [["Bash", 1, true]] as [string, number, boolean][],
      MetricSeries: [["s1", "commits", "", "", "", 2]] as [
        string,
        string,
        string,
        string,
        string,
        number,
      ][],
    };

    const [encoded] = codec.encodeRows({
      columns: wire,
      columnNames: columns,
      rows: [row],
    });
    const [decoded] = codec.decodeRows<typeof row>({
      columns: wire,
      columnNames: columns,
      header: undefined,
      rows: [encoded!],
    });

    expect(decoded).toEqual(row);
  });
});
