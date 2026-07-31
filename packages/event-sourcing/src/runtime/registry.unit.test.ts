import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigurationError } from "../errors";
import { definePipeline } from "../pipeline/definePipeline";
import {
  checkTypeStringRatchet,
  snapshotFromRegistry,
} from "../pipeline/ratchet";
import type {
  ReplaceStore,
  StateRead,
  StoredState,
} from "../projections/store.types";
import { createRegistry } from "./registry";

/**
 * The registry indexes every pipeline once at registration (ADR-108 decision
 * 1). These tests are about what the index buys: collisions caught the
 * moment they are decidable, an unresolvable command port caught once
 * registration is done, the aggregate id map made live (ADR-107 decision 4),
 * and the ratchet driven from the registry rather than one module per
 * pipeline (ADR-107 decision 12).
 */

const spanReceived = z.object({ traceId: z.string(), spanId: z.string() });
const topicAssigned = z.object({ traceId: z.string(), topic: z.string() });

function memoryReplaceStore<State>(): ReplaceStore<State> {
  const rows = new Map<string, StoredState<State>>();
  return {
    kind: "replace",
    async read(key): Promise<StateRead<State>> {
      const found = rows.get(key);
      return found ? { kind: "found", stored: found } : { kind: "absent" };
    },
    async write(key, stored) {
      rows.set(key, stored);
    },
  };
}

function tracePipeline(commandName = "recordSpan") {
  return definePipeline("trace")
    .events({ spanReceived })
    .withCommand(commandName, {
      input: spanReceived,
      handle: async (input) => [{ type: "spanReceived", data: input }],
    })
    .build();
}

function fullPipeline() {
  return definePipeline("trace")
    .events({ spanReceived })
    .id({ spanReceived: (d) => d.traceId })
    .withFold("summary", {
      state: z.object({ n: z.number() }),
      init: () => ({ n: 0 }),
      on: { spanReceived: (state) => ({ n: state.n + 1 }) },
      store: memoryReplaceStore<{ n: number }>(),
    })
    .withMap("spans", {
      on: { spanReceived: (d) => ({ id: d.spanId }) },
      store: { kind: "append", writeBatch: async () => undefined },
    })
    .withSubscriber("audit", { on: { spanReceived: () => undefined } })
    .withProcessManager("settlement", {
      state: z.object({}),
      init: () => ({}),
      intents: {
        notify: {
          payload: z.object({}),
          messageKey: () => "x",
          deliver: () => undefined,
        },
      },
      on: {
        spanReceived: (state) => ({ state, intents: [], nextWakeAt: null }),
      },
    })
    .build();
}

describe("createRegistry", () => {
  describe("given a registered pipeline claims a command name", () => {
    /** @scenario two pipelines declaring the same command name is refused, naming both */
    it("refuses a second pipeline declaring the identical command name", () => {
      const registry = createRegistry();
      registry.register(tracePipeline("recordSpan"));

      let caught: unknown;
      try {
        registry.register(
          definePipeline("billing")
            .events({ spanReceived })
            .withCommand("recordSpan", {
              input: spanReceived,
              handle: async (input) => [{ type: "spanReceived", data: input }],
            })
            .build(),
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigurationError);
      expect((caught as ConfigurationError).context).toMatchObject({
        command: "recordSpan",
        pipelines: ["trace", "billing"],
      });
    });
  });

  describe("given a registered pipeline derives a persisted event type", () => {
    /** @scenario two pipelines deriving the same event type string is refused, naming both */
    it("refuses a second, independently built pipeline deriving the identical event type", () => {
      const registry = createRegistry();
      registry.register(
        definePipeline("trace").events({ spanReceived }).build(),
      );

      let caught: unknown;
      try {
        registry.register(
          definePipeline("trace").events({ spanReceived }).build(),
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigurationError);
      expect((caught as ConfigurationError).context).toMatchObject({
        eventType: "trace/spanReceived",
        pipelines: ["trace", "trace"],
      });
    });
  });

  describe("given a port is bound for a command name", () => {
    /** @scenario a command port bound for a name no registered pipeline owns fails at boot, naming it */
    it("refuses when nothing registered ever claims the bound command", () => {
      const registry = createRegistry();
      registry.register(tracePipeline());
      registry.bindCommandPort("billing/chargeCard");

      let caught: unknown;
      try {
        registry.assertResolvable();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigurationError);
      expect((caught as ConfigurationError).context).toMatchObject({
        commands: ["billing/chargeCard"],
      });
    });

    /** @scenario a command port bound before its owning pipeline registers still resolves once registration completes */
    it("resolves once the owning pipeline registers, even though the port was bound first", () => {
      const registry = createRegistry();
      registry.bindCommandPort("recordSpan");
      expect(registry.findCommand("recordSpan")).toBeNull();

      registry.register(tracePipeline());

      expect(() => registry.assertResolvable()).not.toThrow();
    });
  });

  describe("given a built pipeline's id map", () => {
    /** @scenario dispatching an event with no declared id extractor is refused, naming the event type */
    it("refuses to resolve an aggregate id for an event with no declared extractor", () => {
      const built = definePipeline("trace").events({ spanReceived }).build();

      let caught: unknown;
      try {
        built.aggregateIdFor("trace/spanReceived", {
          traceId: "t1",
          spanId: "s1",
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigurationError);
      expect((caught as ConfigurationError).context).toMatchObject({
        pipeline: "trace",
        eventType: "trace/spanReceived",
      });
    });

    /** @scenario every declared event resolves its id through the extractor declared for its own key */
    it("resolves every declared event's id through the extractor declared for its own key", () => {
      const built = definePipeline("trace")
        .events({ spanReceived, topicAssigned })
        .id({
          spanReceived: (d) => `span:${d.traceId}`,
          topicAssigned: (d) => `topic:${d.traceId}`,
        })
        .build();

      expect(
        built.aggregateIdFor("trace/spanReceived", {
          traceId: "t1",
          spanId: "s1",
        }),
      ).toBe("span:t1");
      expect(
        built.aggregateIdFor("trace/topicAssigned", {
          traceId: "t1",
          topic: "billing",
        }),
      ).toBe("topic:t1");
    });
  });

  describe("given a snapshot produced from a registry with a pipeline registered", () => {
    /** @scenario a type string the registry no longer produces is reported as missing */
    it("reports every one of that pipeline's type strings once it is no longer registered", () => {
      const before = createRegistry();
      before.register(definePipeline("trace").events({ spanReceived }).build());
      const snapshot = snapshotFromRegistry(before);

      const after = createRegistry();
      const current = snapshotFromRegistry(after);

      expect(checkTypeStringRatchet({ snapshot, current })).toEqual([
        { declaration: "trace", missing: ["trace/spanReceived"] },
      ]);
    });

    /** @scenario a type string newly added to the registry is never reported */
    it("never reports a type string the registry additionally declares now", () => {
      const before = createRegistry();
      before.register(definePipeline("trace").events({ spanReceived }).build());
      const snapshot = snapshotFromRegistry(before);

      const after = createRegistry();
      after.register(
        definePipeline("trace").events({ spanReceived, topicAssigned }).build(),
      );
      const current = snapshotFromRegistry(after);

      expect(checkTypeStringRatchet({ snapshot, current })).toEqual([]);
    });

    it("walks a process manager's intents alongside its pipeline's events", () => {
      const registry = createRegistry();
      registry.register(fullPipeline());
      const snapshot = snapshotFromRegistry(registry);

      expect(snapshot.trace).toEqual(["trace/spanReceived"]);
      expect(snapshot["trace/settlement"]).toEqual(["settlement/notify"]);
    });
  });

  describe("given the registry is the whole introspection surface", () => {
    it("lists every registered pipeline through all()", () => {
      const registry = createRegistry();
      registry.register(tracePipeline());
      expect(registry.all()).toEqual([
        {
          pipeline: expect.objectContaining({ name: "trace" }),
          aggregateType: "trace",
        },
      ]);
    });

    it("lists every registered command through commandNames()", () => {
      const registry = createRegistry();
      registry.register(tracePipeline());
      expect(registry.commandNames()).toEqual(["recordSpan"]);
    });

    it("returns null from findCommand for a name nothing registered", () => {
      const registry = createRegistry();
      expect(registry.findCommand("nothing")).toBeNull();
    });

    it("resolves every member kind by event type, and nothing for an unmatched one", () => {
      const registry = createRegistry();
      registry.register(fullPipeline());

      expect(
        registry.foldsFor("trace/spanReceived").map((m) => m.name),
      ).toEqual(["summary"]);
      expect(registry.mapsFor("trace/spanReceived").map((m) => m.name)).toEqual(
        ["spans"],
      );
      expect(
        registry.subscribersFor("trace/spanReceived").map((m) => m.name),
      ).toEqual(["audit"]);
      expect(
        registry.processManagersFor("trace/spanReceived").map((m) => m.name),
      ).toEqual(["settlement"]);

      expect(registry.foldsFor("trace/unknown")).toEqual([]);
      expect(registry.mapsFor("trace/unknown")).toEqual([]);
      expect(registry.subscribersFor("trace/unknown")).toEqual([]);
      expect(registry.processManagersFor("trace/unknown")).toEqual([]);
    });
  });
});
