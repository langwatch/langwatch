import { parseGroupKey } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  experimentRunItemsGroupKey,
  experimentRunStateGroupKey,
  renderExperimentRunItemsGroupKey,
  renderExperimentRunStateGroupKey,
} from "./dispatch";

describe("experimentRunStateGroupKey", () => {
  it("scopes the fold to one lane per aggregate (ADR-106: fold-scope-must-be-aggregate)", () => {
    expect(
      experimentRunStateGroupKey({
        tenantId: "tenant-1",
        aggregateId: "exp-1:run-1",
      }),
    ).toEqual({
      tenantId: "tenant-1",
      lane: { kind: "fold", name: "experimentRunState" },
      scope: {
        kind: "aggregate",
        aggregateType: "experiment_run",
        aggregateId: "exp-1:run-1",
      },
    });
  });

  it("renders through the package's own renderer and round-trips", () => {
    const args = { tenantId: "tenant-1", aggregateId: "exp-1:run-1" };
    expect(parseGroupKey(renderExperimentRunStateGroupKey(args))).toEqual(
      experimentRunStateGroupKey(args),
    );
  });
});

describe("experimentRunItemsGroupKey", () => {
  it("scopes the map to one lane per dataset row, not per event", () => {
    expect(
      experimentRunItemsGroupKey({
        tenantId: "tenant-1",
        experimentId: "exp-1",
        runId: "run-1",
        index: 3,
      }),
    ).toEqual({
      tenantId: "tenant-1",
      lane: { kind: "map", name: "experimentRunItems" },
      scope: { kind: "partition", parts: ["exp-1", "run-1", "3"] },
    });
  });

  it("gives two different dataset rows two different lanes", () => {
    const base = { tenantId: "tenant-1", experimentId: "exp-1", runId: "run-1" };
    expect(experimentRunItemsGroupKey({ ...base, index: 0 })).not.toEqual(
      experimentRunItemsGroupKey({ ...base, index: 1 }),
    );
  });

  it("round-trips even when a part contains the key separator", () => {
    const args = {
      tenantId: "tenant-1",
      experimentId: "exp/with/slashes",
      runId: "run-1",
      index: 0,
    };
    expect(parseGroupKey(renderExperimentRunItemsGroupKey(args))).toEqual(
      experimentRunItemsGroupKey(args),
    );
  });
});
