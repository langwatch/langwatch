/**
 * State projections ran for months with no settable kill switch, because
 * this walk stopped at fold and map.
 * @see specs/ops/state-projection-visibility.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  defineAggregate,
  definePipeline,
  EventSchema,
  type FoldProjectionStore,
  type StateProjectionOptions,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EventingIntrospectionService } from "../eventing-introspection.service.ts";

const GRANTED = "lw.authz.authz_grants.granted";
const grantedSchema = z.object({ ...EventSchema.shape, type: z.literal(GRANTED) });

type GrantsState = { granted: number };

function definitionWith({ stateOptions }: { stateOptions?: StateProjectionOptions } = {}) {
  return definePipeline({
    name: "authz_grants",
    aggregate: defineAggregate({ type: "authz_grants" }),
  })
    .withEvents([grantedSchema])
    .withClickHouseFoldProjection({
      name: "grantsFold",
      version: "2026-01-01",
      eventTypes: [GRANTED],
      init: (): GrantsState => ({ granted: 0 }),
      apply: (state) => state,
      store: createApiFixture<FoldProjectionStore<GrantsState>>(),
      LastEventOccurredAtKey: "lastEventOccurredAt",
    })
    .withPostgresProjection({
      name: "authzGrantsState",
      version: "2026-01-01",
      eventTypes: [GRANTED],
      init: (): GrantsState => ({ granted: 0 }),
      apply: (state) => state,
      store: createApiFixture<StateProjectionStore<GrantsState>>(),
      options: stateOptions,
    })
    .build();
}

function adapterFor(definition: ReturnType<typeof definitionWith>) {
  return EventingIntrospectionService.create(() => [definition]);
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
