/**
 * The seam between a module and the event-sourced half of a process. The
 * shapes below are structural on purpose: this file imports nothing from
 * `@langwatch/eventing`, because composition depends on none of it.
 * Spec: specs/server/declarative-process-composition.feature
 */
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/application.ts";
import { defineServerModule, type FeatureSetup } from "../src/feature-installer.ts";
import type { FeatureEventing, FeatureEventingSetup } from "../src/module-eventing.ts";
import { defineRepositories } from "../src/repository-registry.ts";

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

const keyRepositories = defineRepositories({ memory: MemoryKeyRepositories });

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

describe("given a module that declares its event sourcing with withEventing", () => {
  describe("when the process holds an eventing runtime", () => {
    /** @scenario "A module declares its event sourcing beside its transports" */
    it("registers the pipeline the module named", async () => {
      const eventing = eventingHost("consume");
      const module = defineServerModule("api-key")
        .withRepositories(keyRepositories)
        .withApp(ComposedKeyApp)
        .withEventing(keyEventing());

      await createApp({ role: "worker", infrastructure: { eventing: eventing.host } })
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
        infrastructure: { eventing: eventing.host },
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
        infrastructure: { eventing: eventing.host },
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

      await createApp({ role: "worker", infrastructure: { eventing: eventing.host } })
        .withModules([module])
        .boot();

      expect(eventing.host.processStore.pruned).toEqual(["agent_sandbox_maintenance"]);
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

      const runtime = await createApp({ role: "tasks", infrastructure: {} })
        .withModules([module])
        .boot();

      expect(runtime.service(KeyApp)).toBeInstanceOf(ComposedKeyApp);
      expect(declaration.built).toEqual([]);
    });
  });
});
