/**
 * State projections ran for months with no settable kill switch, because
 * this walk stopped at fold and map.
 * @see specs/ops/state-projection-visibility.feature
 */
import type { StaticPipelineDefinition } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import { EventingOpsIntrospectionAdapter } from "../eventing.ops-introspection.service.ts";

function definitionWith({
  stateOptions,
}: {
  stateOptions?: { killSwitch?: { customKey?: string } };
} = {}): StaticPipelineDefinition<any, any, any> {
  return {
    metadata: { name: "authz_grants", aggregateType: "authz_grants" },
    foldProjections: new Map([["grantsFold", { definition: { name: "grantsFold" } }]]),
    mapProjections: new Map(),
    stateProjections: new Map([
      ["authzGrantsState", { name: "authzGrantsState", options: stateOptions }],
    ]),
    commands: [],
    foldSubscribers: new Map(),
    mapSubscribers: new Map(),
    eventSubscribers: new Map(),
    processManagers: new Map(),
  } as unknown as StaticPipelineDefinition<any, any, any>;
}

function adapterFor(definition: StaticPipelineDefinition<any, any, any>) {
  return EventingOpsIntrospectionAdapter.create(() => [definition]);
}

describe("given a pipeline registering a state projection", () => {
  describe("when the kill-switch descriptors are generated", () => {
    /** @scenario A state projection's kill switch can be reached from the flags page */
    it("emits the fold-shaped key the runtime actually checks", () => {
      const keys = adapterFor(definitionWith())
        .killSwitches()
        .map((descriptor) => descriptor.key);

      expect(keys).toContain("es-authz_grants-projection-authzGrantsState-killswitch");
      expect(keys).toContain("es-authz_grants-projection-grantsFold-killswitch");
    });

    it("emits a custom key when the projection declares one", () => {
      const keys = adapterFor(
        definitionWith({ stateOptions: { killSwitch: { customKey: "custom-authz-switch" } } }),
      )
        .killSwitches()
        .map((descriptor) => descriptor.key);

      expect(keys).toContain("custom-authz-switch");
      expect(keys).not.toContain("es-authz_grants-projection-authzGrantsState-killswitch");
    });
  });
});
