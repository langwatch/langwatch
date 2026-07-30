import { parseGroupKey } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  experimentRunResultStorageGroupKey,
  experimentRunStateGroupKey,
  renderExperimentRunResultStorageGroupKey,
  renderExperimentRunStateGroupKey,
} from "./groupKey";

describe("experimentRunStateGroupKey", () => {
  it("scopes the fold to one lane per aggregate (ADR-106: fold-scope-must-be-aggregate)", () => {
    const key = experimentRunStateGroupKey({
      tenantId: "tenant-1",
      aggregateId: "exp-1:run-1",
    });
    expect(key).toEqual({
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
    const rendered = renderExperimentRunStateGroupKey(args);
    expect(parseGroupKey(rendered)).toEqual(experimentRunStateGroupKey(args));
  });
});

describe("experimentRunResultStorageGroupKey", () => {
  it("scopes the map to one lane per dataset row, not per event (ADR-100 decision 2)", () => {
    const key = experimentRunResultStorageGroupKey({
      tenantId: "tenant-1",
      experimentId: "exp-1",
      runId: "run-1",
      index: 3,
    });
    expect(key).toEqual({
      tenantId: "tenant-1",
      lane: { kind: "map", name: "experimentRunResultStorage" },
      scope: { kind: "partition", parts: ["exp-1", "run-1", "3"] },
    });
  });

  it("gives two different dataset rows two different lanes", () => {
    const a = experimentRunResultStorageGroupKey({
      tenantId: "tenant-1",
      experimentId: "exp-1",
      runId: "run-1",
      index: 0,
    });
    const b = experimentRunResultStorageGroupKey({
      tenantId: "tenant-1",
      experimentId: "exp-1",
      runId: "run-1",
      index: 1,
    });
    expect(a).not.toEqual(b);
  });

  it("renders through the package's own renderer and round-trips, even when a part contains the separator", () => {
    const args = {
      tenantId: "tenant-1",
      experimentId: "exp/with/slashes",
      runId: "run-1",
      index: 0,
    };
    const rendered = renderExperimentRunResultStorageGroupKey(args);
    expect(parseGroupKey(rendered)).toEqual(
      experimentRunResultStorageGroupKey(args),
    );
  });
});
