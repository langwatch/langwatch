import { describe, expect, it } from "vitest";
import { traceViewContextChip } from "../hooks/useLangyTraceViewContext";

describe("traceViewContextChip", () => {
  const timeRange = {
    from: Date.parse("2026-07-01T00:00:00.000Z"),
    to: Date.parse("2026-07-16T00:00:00.000Z"),
    label: "Last 15 days",
    presetId: "15d",
  };

  it("describes the complete unfiltered Trace Explorer view", () => {
    const chip = traceViewContextChip({ queryText: "", timeRange });

    expect(chip.label).toBe("Traces · Last 15 days");
    expect(chip.ref).toContain("data source: traces");
    expect(chip.ref).toContain("time range: Last 15 days");
    expect(chip.ref).not.toContain("search:");
  });

  it("includes the exact active search without turning it into the label", () => {
    const chip = traceViewContextChip({
      queryText: 'status:"error" AND duration:>5m',
      timeRange,
    });

    expect(chip.label).toBe("Traces · Last 15 days · searched");
    expect(chip.ref).toContain(
      'search and attribute filters: status:"error" AND duration:>5m',
    );
  });

  it("carries the active lens or saved view identity", () => {
    const chip = traceViewContextChip({
      queryText: 'service.name:"checkout"',
      timeRange,
      lens: {
        id: "view_checkout_errors",
        name: "Checkout errors",
        isSavedView: true,
        hasLocalChanges: true,
      },
      grouping: "by-service",
      sort: { columnId: "duration", direction: "desc" },
    });

    expect(chip.label).toBe(
      "Traces · Checkout errors · Last 15 days · searched",
    );
    expect(chip.ref).toContain("saved view: Checkout errors");
    expect(chip.ref).toContain("local changes: yes");
    expect(chip.ref).toContain("grouping: by-service");
    expect(chip.ref).toContain("sort: duration desc");
  });
});
