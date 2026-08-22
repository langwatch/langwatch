/**
 * The ops introspection walks every projection KIND, not just the fold/map
 * pair it grew up with. State projections (`.withProjection()`, running as
 * `__jobType=stateProjection`) ran for months with no row on the projections
 * page, no settable kill switch and no replay-wizard entry, because these
 * walks stopped at fold+map — the authz grants ledger stalled invisibly
 * during its production rollout exactly this way.
 */
import { describe, expect, it, vi } from "vitest";

const definitions: unknown[] = [];
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ eventSourcing: { definitions } }),
  tryGetApp: () => ({ eventSourcing: { definitions } }),
}));

import {
  getKillSwitchDescriptors,
  getProjectionMetadata,
} from "../pipelineRegistry";

function definitionWith({
  stateOptions,
}: {
  stateOptions?: { killSwitch?: { customKey?: string } };
} = {}) {
  return {
    metadata: {
      name: "authz_grants",
      aggregateType: "authz_grants",
      aggregateScope: { types: ["authz_grants"] },
    },
    foldProjections: new Map([
      ["grantsFold", { definition: { name: "grantsFold" } }],
    ]),
    mapProjections: new Map(),
    stateProjections: new Map([
      ["authzGrantsState", { name: "authzGrantsState", options: stateOptions }],
    ]),
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

  describe("when the kill-switch descriptors are generated", () => {
    /** @scenario A state projection's kill switch can be reached from the flags page */
    it("emits the fold-shaped key the runtime actually checks", () => {
      definitions.splice(0, definitions.length, definitionWith());

      const keys = getKillSwitchDescriptors().map((d) => d.key);

      expect(keys).toContain(
        "es-authz_grants-projection-authzGrantsState-killswitch",
      );
    });

    it("emits a custom key when the projection declares one", () => {
      definitions.splice(
        0,
        definitions.length,
        definitionWith({
          stateOptions: { killSwitch: { customKey: "custom-authz-switch" } },
        }),
      );

      const keys = getKillSwitchDescriptors().map((d) => d.key);

      expect(keys).toContain("custom-authz-switch");
      expect(keys).not.toContain(
        "es-authz_grants-projection-authzGrantsState-killswitch",
      );
    });
  });
});
