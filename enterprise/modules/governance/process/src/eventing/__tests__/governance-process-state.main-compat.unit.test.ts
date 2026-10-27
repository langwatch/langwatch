import { describe, expect, it } from "vitest";

import { costRollupWatchStateSchema } from "../cost-rollup-watch.process.ts";
import { ingestionPullProcessStateSchema } from "../ingestion-pull.process.ts";
import { pulledUsageLedgerStateSchema } from "../pulled-usage-ledger.process.ts";

describe("process state stored by the main release", () => {
  it("parses a cost rollup watch state as main stored it", () => {
    expect(
      costRollupWatchStateSchema.parse({
        pendingDays: ["2026-09-01"],
        armedAt: 1_760_000_000_000,
        marks: 2,
      }),
    ).toEqual({ pendingDays: ["2026-09-01"], armedAt: 1_760_000_000_000, marks: 2 });
  });
  it("parses a pulled usage ledger state as main stored it", () => {
    expect(
      pulledUsageLedgerStateSchema.parse({
        filedCell: {
          model: "gpt",
          currencyCode: "USD",
          agentId: "a",
          rawActorId: "r",
          occurredAtMs: 1,
        },
      }),
    ).toEqual({
      filedCell: {
        model: "gpt",
        currencyCode: "USD",
        agentId: "a",
        rawActorId: "r",
        occurredAtMs: 1,
      },
    });
  });
  it("parses an ingestion pull state stored before the listing slots existed", () => {
    expect(
      ingestionPullProcessStateSchema.parse({
        sourceId: "src_1",
        enabled: true,
        cron: null,
        cursor: null,
        currentRun: null,
      }),
    ).toEqual({ sourceId: "src_1", enabled: true, cron: null, cursor: null, currentRun: null });
  });
});
