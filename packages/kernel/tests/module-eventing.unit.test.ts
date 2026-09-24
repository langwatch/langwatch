/**
 * The module/eventing seam, with structural shapes: composition depends on
 * nothing from `@langwatch/eventing`, so neither does this file.
 * Spec: specs/server/declarative-process-composition.feature
 */
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/application.ts";
import { defineServerModule, type FeatureSetup } from "../src/feature-installer.ts";
import type { FeatureEventing, FeatureEventingSetup } from "../src/module-eventing.ts";
import { defineRepositories } from "../src/repository-registry.ts";
import { memberSourceOf } from "./member-source.ts";

/** One row store, so two graphs over the same rows are distinguishable. */
class KeyDatabase {
  readonly revoked: string[] = [];
}

interface KeyRepositories {
  readonly keys: KeyDatabase;
}

class MemoryKeyRepositories {
  static readonly requires = [] as const;
  static create(): KeyRepositories {
    return { keys: new KeyDatabase() };
  }
}

const keyRepositories = defineRepositories({
  live: MemoryKeyRepositories,
  memory: MemoryKeyRepositories,
});

abstract class KeyApp {
  abstract readonly repositories: KeyRepositories;
  abstract reap(): void;
}

class ComposedKeyApp extends KeyApp {
  static readonly contract = KeyApp;
  static readonly dependencies = {};

  /** What `connect` handed back, so the test can see the senders arrive. */
  sender: unknown;

  private constructor(readonly repositories: KeyRepositories) {
    super();
  }

  static create(
    setup: FeatureSetup<
      typeof ComposedKeyApp.dependencies,
      Readonly<Record<string, unknown>>,
      undefined,
      KeyRepositories
    >,
  ): ComposedKeyApp {
    return new ComposedKeyApp(setup.repositories);
  }

  reap(): void {
    this.repositories.keys.revoked.push("reaped");
  }
}

type KeySetup = FeatureEventingSetup<KeyRepositories, KeyApp, { pruned: string[] }>;

/** What the module declares: one pipeline, built over its own two halves. */
function keyEventing(): FeatureEventing<KeyRepositories, KeyApp, { pruned: string[] }> & {
  readonly built: KeySetup[];
} {
  const built: KeySetup[] = [];
  return {
    pipeline: "agent_sandbox_maintenance",
    built,
    build(setup: KeySetup) {
      built.push(setup);
      setup.processStore.pruned.push(this.pipeline);
      return { name: this.pipeline, sweep: () => setup.repositories.keys.revoked.push("swept") };
    },
    connect({ app, commands }) {
      (app as ComposedKeyApp).sender = commands.startSweep;
    },
  };
}

function eventingHost(participation: "produce" | "consume") {
  const registered: { name: string }[] = [];
  const startSweep = { send: vi.fn() };
  return {
    registered,
    startSweep,
    host: {
      participation,
      processStore: { pruned: [] as string[] },
      register: (definition: unknown) => {
        registered.push(definition as { name: string });
        return { commands: { startSweep } };
      },
    },
  };
}

/** An eventing runtime as every normal process holds one: it states no half. */
function runtimeStatingNothing() {
  return {
    processStore: { pruned: [] as string[] },
    register: () => ({ commands: { startSweep: { send: vi.fn() } } }),
  };
}

describe("given a module that declares its event sourcing with withEventing", () => {
  describe("when the process holds an eventing runtime", () => {
    /** @scenario "A module declares its event sourcing beside its transports" */
    it("registers the pipeline the module named", async () => {
      const eventing = eventingHost("consume");
      const module = defineServerModule("api-key")
        .withRepositories(keyRepositories)
        .withApp(ComposedKeyApp)
        .withEventing(keyEventing());

      await createApp({ role: "worker", members: memberSourceOf({ eventing: eventing.host }) })
        .withModules([module])
        .boot();

      expect(eventing.registered.map((definition) => definition.name)).toEqual([
        "agent_sandbox_maintenance",
      ]);
    });

    /** @scenario "A module declares its event sourcing beside its transports" */
    it("builds the pipeline over the repositories the app itself was given", async () => {
      const eventing = eventingHost("consume");
      const declaration = keyEventing();
      const module = defineServerModule("api-key")
        .withRepositories(keyRepositories)
        .withApp(ComposedKeyApp)
        .withEventing(declaration);

      const runtime = await createApp({
        role: "worker",
        members: memberSourceOf({ eventing: eventing.host }),
      })
        .withModules([module])
        .boot();

      const app = runtime.service(KeyApp);
      expect(declaration.built).toHaveLength(1);
      expect(declaration.built[0]!.repositories.keys).toBe(app.repositories.keys);
      expect(declaration.built[0]!.app).toBe(app);
      expect(declaration.built[0]!.participation).toBe("consume");
    });

    /** @scenario "A module declares its event sourcing beside its transports" */
    it("hands the module the senders registration answered with", async () => {
      const eventing = eventingHost("produce");
      const module = defineServerModule("api-key")
        .withRepositories(keyRepositories)
        .withApp(ComposedKeyApp)
        .withEventing(keyEventing());

      const runtime = await createApp({
        role: "api",
        members: memberSourceOf({ eventing: eventing.host }),
      })
        .withModules([module])
        .boot();

      expect((runtime.service(KeyApp) as ComposedKeyApp).sender).toBe(eventing.startSweep);
    });

    /** @scenario "A module declares its event sourcing beside its transports" */
    it("builds against the process store of the graph that installs it", async () => {
      const eventing = eventingHost("consume");
      const module = defineServerModule("api-key")
        .withRepositories(keyRepositories)
        .withApp(ComposedKeyApp)
        .withEventing(keyEventing());

      await createApp({ role: "worker", members: memberSourceOf({ eventing: eventing.host }) })
        .withModules([module])
        .boot();

      expect(eventing.host.processStore.pruned).toEqual(["agent_sandbox_maintenance"]);
    });
  });

  describe("when a pipeline reads its own aggregate's earlier events", () => {
    /** @scenario "A pipeline reads its own aggregate's earlier events" */
    it("reads the event log under the aggregate type its definition declares", async () => {
      const reads: unknown[][] = [];
      const setups: FeatureEventingSetup<KeyRepositories, KeyApp, unknown>[] = [];
      const pipeline = (
        name: string,
        aggregate: string,
      ): FeatureEventing<KeyRepositories, KeyApp> => ({
        pipeline: name,
        build: (setup) => {
          setups.push(setup);
          return { name, aggregate: { type: aggregate } };
        },
      });
      const host = {
        processStore: {},
        eventStore: {
          getEvents: (...args: unknown[]) => {
            reads.push(args);
            return Promise.resolve([{ type: "queued" }, "not an event", { type: "finished" }]);
          },
        },
        register: () => ({}),
      };
      const module = defineServerModule("api-key")
        .withRepositories(keyRepositories)
        .withApp(ComposedKeyApp)
        .withEventing(pipeline("scenario_lifecycle", "scenario"))
        .withEventing(pipeline("simulation_processing", "simulation_run"));

      await createApp({ role: "worker", members: memberSourceOf({ eventing: host }) })
        .withModules([module])
        .boot();

      const events = await setups[1]!.priorEvents!({
        tenantId: "project_1",
        aggregateId: "run_1",
        accepts: (event): event is { type: string } =>
          typeof event === "object" && event !== null && "type" in event,
      });
      expect(reads).toEqual([["run_1", { tenantId: "project_1" }, "simulation_run"]]);
      expect(events).toEqual([{ type: "queued" }, { type: "finished" }]);
    });
  });

  describe("when the runtime states no participation of its own", () => {
    /** @scenario "The role decides which half a process installs" */
    it("installs the worker's declaration as a consumer", async () => {
      const declaration = keyEventing();
      const module = defineServerModule("api-key")
        .withRepositories(keyRepositories)
        .withApp(ComposedKeyApp)
        .withEventing(declaration);

      await createApp({
        role: "worker",
        members: memberSourceOf({ eventing: runtimeStatingNothing() }),
      })
        .withModules([module])
        .boot();

      expect(declaration.built[0]!.participation).toBe("consume");
    });

    /** @scenario "The role decides which half a process installs" */
    it("installs the api's declaration as a producer", async () => {
      const declaration = keyEventing();
      const module = defineServerModule("api-key")
        .withRepositories(keyRepositories)
        .withApp(ComposedKeyApp)
        .withEventing(declaration);

      await createApp({
        role: "api",
        members: memberSourceOf({ eventing: runtimeStatingNothing() }),
      })
        .withModules([module])
        .boot();

      expect(declaration.built[0]!.participation).toBe("produce");
    });
  });

  describe("when the module hosts several pipelines", () => {
    /** @scenario "A module hosts several pipelines" */
    it("registers each in the order declared and connects each to its own senders", async () => {
      const connected: string[] = [];
      const pipeline = (name: string): FeatureEventing<KeyRepositories, KeyApp> => ({
        pipeline: name,
        build: () => ({ name }),
        connect: ({ commands }) => {
          connected.push(`${name}:${String(commands.owner)}`);
        },
      });
      const registered: string[] = [];
      const host = {
        participation: "consume" as const,
        processStore: { pruned: [] as string[] },
        register: (definition: unknown) => {
          const { name } = definition as { name: string };
          registered.push(name);
          return { commands: { owner: name } };
        },
      };
      const module = defineServerModule("api-key")
        .withRepositories(keyRepositories)
        .withApp(ComposedKeyApp)
        .withEventing(pipeline("agent_sandbox_maintenance"))
        .withEventing(pipeline("key_rotation"))
        .withEventing(pipeline("key_audit"));

      await createApp({ role: "worker", members: memberSourceOf({ eventing: host }) })
        .withModules([module])
        .boot();

      expect(registered).toEqual(["agent_sandbox_maintenance", "key_rotation", "key_audit"]);
      expect(connected).toEqual([
        "agent_sandbox_maintenance:agent_sandbox_maintenance",
        "key_rotation:key_rotation",
        "key_audit:key_audit",
      ]);
    });
  });

  describe("when the runtime offers its own maintenance pipelines", () => {
    const bootOver = async (participation: "produce" | "consume") => {
      const eventing = eventingHost(participation);
      const host = {
        ...eventing.host,
        maintenancePipelines: () => [
          { name: "blob_maintenance" },
          { name: "process_manager_maintenance" },
        ],
      };
      const module = defineServerModule("api-key")
        .withRepositories(keyRepositories)
        .withApp(ComposedKeyApp)
        .withEventing(keyEventing());
      await createApp({ role: "worker", members: memberSourceOf({ eventing: host }) })
        .withModules([module])
        .boot();
      return eventing.registered.map((definition) => definition.name);
    };

    /** @scenario "The draining role installs the framework's maintenance pipelines" */
    it("registers them after the modules' own only where the role drains", async () => {
      expect(await bootOver("consume")).toEqual([
        "agent_sandbox_maintenance",
        "blob_maintenance",
        "process_manager_maintenance",
      ]);
      expect(await bootOver("produce")).toEqual(["agent_sandbox_maintenance"]);
    });
  });

  describe("when the process runs no event sourcing", () => {
    /** @scenario "A role that runs no event sourcing ignores the declaration" */
    it("boots without building or registering anything", async () => {
      const declaration = keyEventing();
      const module = defineServerModule("api-key")
        .withRepositories(keyRepositories)
        .withApp(ComposedKeyApp)
        .withEventing(declaration);

      const runtime = await createApp({ role: "tasks", members: memberSourceOf({}) })
        .withModules([module])
        .boot();

      expect(runtime.service(KeyApp)).toBeInstanceOf(ComposedKeyApp);
      expect(declaration.built).toEqual([]);
    });
  });
});
