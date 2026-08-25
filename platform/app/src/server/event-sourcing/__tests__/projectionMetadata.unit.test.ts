/**
 * The ops introspection walks every projection KIND, not just the fold/map
 * pair it grew up with. State projections (`.withPostgresProjection()`,
 * running as `__jobType=stateProjection`) must appear in operational
 * metadata alongside fold and map projections.
 */
import { describe, expect, it, vi } from "vitest";

const definitions: unknown[] = [];
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ eventSourcing: { definitions } }),
  tryGetApp: () => ({ eventSourcing: { definitions } }),
}));

import { getProjectionMetadata } from "../registration/pipelineRegistry";

function definitionWith() {
  return {
    metadata: { name: "authz_grants", aggregateType: "authz_grants" },
    foldProjections: new Map([["grantsFold", { definition: { name: "grantsFold" } }]]),
    mapProjections: new Map(),
    stateProjections: new Map([["authzGrantsState", { name: "authzGrantsState" }]]),
    commands: [],
    eventSubscribers: new Map(),
  };
}

describe("given a pipeline registering a state projection", () => {
  describe("when the projection registry metadata is collected", () => {
    /** @scenario Every state projection is listed, idle or not */
    it("lists the state projection with a stateProjection pause key", () => {
      definitions.splice(0, definitions.length, definitionWith());

      const rows = getProjectionMetadata();
      const state = rows.find((r) => r.projectionName === "authzGrantsState");

      expect(state).toMatchObject({
        pipelineName: "authz_grants",
        aggregateType: "authz_grants",
        kind: "state",
        pauseKey: "authz_grants/stateProjection/authzGrantsState",
      });
      expect(rows.map((r) => r.kind)).toContain("fold");
    });
  });
});
