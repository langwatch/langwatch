import {
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  type FoldProjectionStore,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EventingIntrospectionService } from "../eventing-introspection.service.ts";

const GRANTED = "lw.authz.authz_grants.granted";
const grantedSchema = z.object({ ...EventSchema.shape, type: z.literal(GRANTED) });

type GrantsState = { granted: number };

function definitionWith() {
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
    })
    .build();
}

describe("given an api that registered a pipeline commands-only and described its consume side", () => {
  const events = () =>
    definePipeline({
      name: "authz_grants",
      aggregate: defineAggregate({ type: "authz_grants" }),
    }).withEvents([grantedSchema]);
  const commandsOnly = events().build();
  const consumeSide = events()
    .withEventSubscriber("notifyGrants", { events: [GRANTED], handler: async () => {} })
    .build();

  /** @scenario The api lists the projections and subscribers the worker runs */
  it("lists the described consume side, which the commands-only registration did not carry", () => {
    const eventing = new EventSourcing({
      enabled: false,
      participation: "produce",
      processManagerMode: "producer-only",
    });
    eventing.register(commandsOnly);
    const registry = EventingIntrospectionService.create(() => eventing.definitions);
    expect(registry.listRegistrations()).toEqual({ projections: [], eventSubscribers: [] });

    eventing.describe(consumeSide);

    expect(registry.listRegistrations()).toEqual({
      projections: [],
      eventSubscribers: [
        {
          subscriberName: "notifyGrants",
          pipelineName: "authz_grants",
          aggregateType: "authz_grants",
          eventTypes: [GRANTED],
        },
      ],
    });
  });

  it("lists a described fold projection with the pause key the queue checks", () => {
    const eventing = new EventSourcing({ enabled: false, participation: "produce" });
    eventing.describe(definitionWith());

    expect(
      EventingIntrospectionService.create(() => eventing.definitions)
        .listRegistrations()
        .projections.map((p) => p.pauseKey),
    ).toEqual([
      "authz_grants/projection/grantsFold",
      "authz_grants/stateProjection/authzGrantsState",
    ]);
  });
});
