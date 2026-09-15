import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/application.ts";
import { memberSourceOf } from "./member-source.ts";
import {
  DependencyCycleError,
  DuplicateProviderError,
  FeatureConfigError,
  MissingProviderError,
  RoleContributionError,
} from "../src/boot-errors.ts";
import { type FeatureConfigSchema, serverFeature } from "../src/feature-installer.ts";

/**
 * A schema as the container asks for it. Any Zod schema satisfies the same
 * `parse`, which is why this package depends on no validator of its own.
 */
const limitsSchema: FeatureConfigSchema<{ maximum: number }> = {
  parse(value: unknown) {
    const maximum = (value as { maximum?: unknown } | undefined)?.maximum;
    if (typeof maximum !== "number") throw new Error("maximum must be a number");
    return { maximum };
  },
};

abstract class GreetingService {
  abstract greet(): string;
}

abstract class GreetingApp {
  abstract readonly greeting: GreetingService;
}

abstract class DirectoryApp {
  abstract readonly directory: DirectoryService;
}

abstract class DirectoryService {
  abstract nameOf(id: string): string;
}

type TestMembers = Readonly<{ prefix: string }>;

class Greeting extends GreetingService {
  constructor(private readonly prefix: string) {
    super();
  }

  greet(): string {
    return `${this.prefix} hello`;
  }
}

class Directory extends DirectoryService {
  nameOf(id: string): string {
    return `person-${id}`;
  }
}

function greetingFeature(setup = vi.fn()) {
  return serverFeature<TestMembers>("greeting")
    .withMembers("prefix")
    .withSetup(({ members }) => {
      setup();
      return { greeting: new Greeting(members.prefix) };
    })
    .provides(GreetingApp)
    .withTransport(({ provided }) => ({ door: { greeting: provided.greeting } }))
    .withRest(({ transport }) => ({ greetings: () => transport.door }))
    .withTrpc(({ transport }) => ({
      door: transport.door,
      greet: () => transport.door.greeting.greet(),
    }))
    .build();
}

describe("the server feature container", () => {
  describe("given a declaration", () => {
    it("constructs nothing until boot", async () => {
      const setup = vi.fn();
      const declaration = greetingFeature(setup);
      const application = createApp({ role: "api", members: memberSourceOf({ prefix: "a" }) })
        .withModules([declaration]);

      expect(setup).not.toHaveBeenCalled();

      await application.boot();
      expect(setup).toHaveBeenCalledOnce();
    });

    it("hands a module the members it named and nothing else", async () => {
      const declaration = serverFeature<TestMembers>("isolated")
        .withMembers("prefix")
        .withSetup(({ members }) => ({ value: members.prefix }))
        .build();

      const booted = await createApp({
        role: "worker",
        members: memberSourceOf({ prefix: "process", unread: "never built" }),
      })
        .withModules([declaration])
        .boot();

      // The process could build `unread`, and does not: nothing asked for it.
      expect(booted.members).toEqual({ prefix: "process" });
      expect(booted.module(declaration).provided.value).toBe("process");
    });

    it("parses the feature's own config slice and refuses one that does not match", async () => {
      const declaration = serverFeature<TestMembers>("limits")
        .withConfig(limitsSchema)
        .withSetup(({ config }) => ({ maximum: config.maximum }))
        .build();

      const booted = await createApp({ role: "api", config: { limits: { maximum: 3 } }, members: memberSourceOf({ prefix: "a" }) })
        .withModules([declaration])
        .boot();
      expect(booted.module(declaration).provided.maximum).toBe(3);

      await expect(
        Promise.resolve().then(() =>
          createApp({ role: "api", config: { limits: { maximum: "three" } }, members: memberSourceOf({ prefix: "a" }) })
            .withModules([declaration])
            .boot(),
        ),
      ).rejects.toBeInstanceOf(FeatureConfigError);
    });
  });

  it("rejects a second provider instead of replacing the public app", () => {
    const declaration = serverFeature<TestMembers>("greeting")
      .withSetup(() => ({ greeting: new Greeting("one") }))
      .provides(GreetingApp);

    expect(() => declaration.provides(GreetingApp)).toThrow(
      'Feature "greeting" already provides its app. Expose services as readonly app members.',
    );
  });

  it("installs a task app without resolving or constructing role-only contributions", async () => {
    const transport = vi.fn();
    const worker = vi.fn();
    const declaration = serverFeature<TestMembers>("greeting")
      .withTransportDependencies({ directory: DirectoryApp })
      .withSetup(() => ({ greeting: new Greeting("task") }))
      .provides(GreetingApp)
      .withTransport(transport)
      .withWorker(worker)
      .build();
    const runtime = await createApp({ role: "tasks", members: memberSourceOf({ prefix: "task" }) })
      .withModules([declaration])
      .boot();

    expect(runtime.service(GreetingApp)).toBe(runtime.module(declaration).provided);
    expect(runtime.service(GreetingApp).greeting.greet()).toBe("task hello");
    expect(() => runtime.module(declaration).worker()).toThrow(RoleContributionError);
    expect(transport).not.toHaveBeenCalled();
    expect(worker).not.toHaveBeenCalled();
  });

  describe("when the same feature is declared twice", () => {
    /** @scenario "Installing the same feature twice fails the boot" */
    it("fails the boot naming the feature and the token it provides twice, constructing nothing", async () => {
      const setup = vi.fn();
      const declaration = greetingFeature(setup);

      const boot = Promise.resolve().then(() =>
        createApp({ role: "api", members: memberSourceOf({ prefix: "a" }) })
          .withModules([declaration, declaration])
          .boot(),
      );

      const error = await boot.catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(DuplicateProviderError);
      expect((error as DuplicateProviderError).token).toBe("GreetingApp");
      expect((error as DuplicateProviderError).features).toEqual(["greeting", "greeting"]);
      expect(setup).not.toHaveBeenCalled();
    });
  });

  describe("when nobody provides a declared dependency", () => {
    /** @scenario "A feature whose dependency nobody provides never serves" */
    it("fails the boot naming the feature, the dependency key and the token, and serves nothing", async () => {
      const setup = vi.fn();
      const declaration = serverFeature<TestMembers>("queue")
        .withDependencies({ directory: DirectoryApp })
        .withSetup(({ dependencies }) => {
          setup();
          return { directory: dependencies.directory };
        })
        .build();

      const boot = Promise.resolve().then(() =>
        createApp({ role: "api", members: memberSourceOf({ prefix: "a" }) })
          .withModules([declaration])
          .boot(),
      );

      const error = await boot.catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(MissingProviderError);
      expect((error as MissingProviderError).feature).toBe("queue");
      expect((error as MissingProviderError).dependencyKey).toBe("directory");
      expect((error as MissingProviderError).token).toBe("DirectoryApp");
      expect(setup).not.toHaveBeenCalled();
    });

  });

  describe("when features depend on each other", () => {
    it("refuses the boot naming the cycle", async () => {
      const first = serverFeature<TestMembers>("first")
        .withDependencies({ directory: DirectoryApp })
        .withSetup(() => ({ greeting: new Greeting("first") }))
        .provides(GreetingApp)
        .build();
      const second = serverFeature<TestMembers>("second")
        .withDependencies({ greeting: GreetingApp })
        .withSetup(() => ({ directory: new Directory() }))
        .provides(DirectoryApp)
        .build();

      const error = await Promise.resolve()
        .then(() =>
          createApp({ role: "api", members: memberSourceOf({ prefix: "a" }) })
            .withModules([first, second])
            .boot(),
        )
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(DependencyCycleError);
      expect((error as DependencyCycleError).cycle).toEqual(["first", "second", "first"]);
    });

    it("constructs a provider before the feature that depends on it", async () => {
      const order: string[] = [];
      const directory = serverFeature<TestMembers>("directory")
        .withSetup(() => {
          order.push("directory");
          return { directory: new Directory() };
        })
        .provides(DirectoryApp)
        .build();
      const queue = serverFeature<TestMembers>("queue")
        .withDependencies({ directory: DirectoryApp })
        .withSetup(() => {
          order.push("queue");
          return {};
        })
        .build();

      await createApp({ role: "api", members: memberSourceOf({ prefix: "a" }) })
        .withModules([queue, directory])
        .boot();

      expect(order).toEqual(["directory", "queue"]);
    });
  });

  describe("when a role does not host a contribution", () => {
    it("selects API contributions from a shared API and worker declaration", async () => {
      const worker = vi.fn(() => ({ consumers: ["index-traces"] }));
      const declaration = serverFeature<TestMembers>("indexing")
        .withSetup(() => ({}))
        .withRest(() => ({ route: "/index" }))
        .withWorker(worker)
        .build();
      const runtime = await createApp({ role: "api", members: memberSourceOf({ prefix: "a" }) })
        .withModules([declaration])
        .boot();

      expect(runtime.module(declaration).rest()).toEqual({ route: "/index" });
      expect(() => runtime.module(declaration).worker()).toThrow(RoleContributionError);
      expect(worker).not.toHaveBeenCalled();
    });

    it("installs the same feature in the worker role without its transport dependencies", async () => {
      const declaration = serverFeature<TestMembers>("indexing")
        .withTransportDependencies({ directory: DirectoryApp })
        .withSetup(() => ({ indexed: true }))
        .withWorker(() => ({ consumers: ["index-traces"] }))
        .build();

      const booted = await createApp({ role: "worker", members: memberSourceOf({ prefix: "a" }) })
        .withModules([declaration])
        .boot();

      expect(booted.module(declaration).worker()).toEqual({ consumers: ["index-traces"] });
    });
  });

  describe("when a boot fails part way", () => {
    it("closes what it already constructed, in reverse order", async () => {
      const closed: string[] = [];
      const directory = serverFeature<TestMembers>("directory")
        .withSetup(() => ({ directory: new Directory() }))
        .provides(DirectoryApp)
        .withClose(() => {
          closed.push("directory");
        })
        .build();
      const failing = serverFeature<TestMembers>("failing")
        .withDependencies({ directory: DirectoryApp })
        .withSetup(() => {
          throw new Error("no index storage");
        })
        .build();

      await expect(
        Promise.resolve().then(() =>
          createApp({ role: "api", members: memberSourceOf({ prefix: "a" }) })
            .withModules([directory, failing])
            .boot(),
        ),
      ).rejects.toThrow("no index storage");
      expect(closed).toEqual(["directory"]);
    });
  });

  describe("when the runtime stops", () => {
    it("stops its services before releasing the features they used", async () => {
      const phases: string[] = [];
      const declaration = serverFeature<TestMembers>("directory")
        .withSetup(() => ({ directory: new Directory() }))
        .withClose(() => {
          phases.push("feature closed");
        })
        .build();

      const booted = await createApp({ role: "worker", members: memberSourceOf({ prefix: "a" }) })
        .withService({
          name: "consumers",
          start: () => {
            phases.push("started");
          },
          stop: () => {
            phases.push("drained");
          },
        })
        .withModules([declaration])
        .boot();

      await booted.start();
      await booted.stop();

      expect(phases).toEqual(["started", "drained", "feature closed"]);
    });
  });

  describe("when both doors read one feature", () => {
    /** @scenario "Both transports answer from one constructed service" */
    it("answers both contributions from the single service the setup constructed", async () => {
      const setup = vi.fn();
      const declaration = greetingFeature(setup);
      const booted = await createApp({ role: "api", members: memberSourceOf({ prefix: "one" }) })
        .withModules([declaration])
        .boot();

      const installed = booted.module(declaration);
      expect(installed.rest().greetings()).toBe(installed.trpc().door);
      expect(installed.trpc().door.greeting).toBe(installed.provided.greeting);
      expect(installed.trpc().greet()).toBe("one hello");
      expect(booted.service(GreetingApp)).toBe(installed.provided);
      expect(setup).toHaveBeenCalledOnce();
    });
  });
});

describe("runtime failure ownership", () => {
  it("constructs a worker contribution once and rejects unavailable transports", async () => {
    const worker = vi.fn(() => ({ consumer: {} }));
    const feature = serverFeature<object>("jobs")
      .withSetup(() => ({}))
      .withWorker(worker)
      .build();
    const runtime = await createApp({ role: "worker", members: memberSourceOf({}) })
      .withModules([feature])
      .boot();
    expect(worker).toHaveBeenCalledOnce();
    expect(runtime.module(feature).worker()).toBe(runtime.module(feature).worker());
    expect(worker).toHaveBeenCalledOnce();
    expect(() => runtime.module(feature).rest()).toThrow(RoleContributionError);
  });

  it.each(["setup", "transport"])(
    "awaits current and prior cleanup after %s fails",
    async (phase) => {
      const closed: string[] = [];
      const failure = new Error("construction failed");
      const first = serverFeature<object>("first")
        .withSetup(() => ({}))
        .withClose(async () => {
          await Promise.resolve();
          closed.push("first");
        })
        .build();
      const failing = serverFeature<object>("failing")
        .withSetup(({ resources }) => {
          resources.own("partial connection", async () => {
            await Promise.resolve();
            closed.push("partial");
          });
          if (phase === "setup") throw failure;
          return {};
        })
        .withClose(async () => {
          await Promise.resolve();
          closed.push("complete");
        })
        .withTransport(() => {
          throw failure;
        })
        .build();
      await expect(
        createApp({ role: "api", members: memberSourceOf({}) })
          .withModules([first, failing])
          .boot(),
      ).rejects.toBe(failure);
      expect(closed).toEqual(
        phase === "setup" ? ["partial", "first"] : ["complete", "partial", "first"],
      );
    },
  );

  it("reports boot and cleanup failures while still closing earlier resources", async () => {
    const failure = new Error("setup");
    const cleanup = new Error("cleanup");
    const closed = vi.fn();
    const feature = serverFeature<object>("failure")
      .withSetup(({ resources }) => {
        resources.own("first", closed);
        resources.own("second", () => {
          throw cleanup;
        });
        throw failure;
      })
      .build();
    const error = await createApp({ role: "tasks", members: memberSourceOf({}) })
      .withModules([feature])
      .boot()
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toHaveProperty("cause", failure);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("serialises concurrent starts and stops and closes each resource once", async () => {
    const phases: string[] = [];
    const runtime = await createApp({ role: "api", members: memberSourceOf({}) })
      .withService({
        name: "listener",
        start: async () => {
          phases.push("start");
          await Promise.resolve();
          phases.push("ready");
        },
        stop: () => {
          phases.push("stop");
        },
      })
      .boot();
    const start = runtime.start();
    expect(runtime.start()).toBe(start);
    const stop = runtime.stop();
    expect(runtime.stop()).toBe(stop);
    await Promise.all([start, stop]);
    expect(phases).toEqual(["start", "ready", "stop"]);
    await expect(runtime.start()).rejects.toThrow("stopped");
  });

  it("rolls back a partial start in reverse order and preserves its failure", async () => {
    const phases: string[] = [];
    const failure = new Error("listener failed");
    const feature = serverFeature<object>("owned")
      .withSetup(() => ({}))
      .withClose(() => {
        phases.push("resources");
      })
      .build();
    const runtime = await createApp({ role: "api", members: memberSourceOf({}) })
      .withService({
        name: "first",
        start: () => {
          phases.push("first start");
        },
        stop: () => {
          phases.push("first stop");
        },
      })
      .withService({
        name: "second",
        start: () => {
          phases.push("second start");
          throw failure;
        },
        stop: () => {
          phases.push("second stop");
        },
      })
      .withModules([feature])
      .boot();
    await expect(runtime.start()).rejects.toBe(failure);
    await runtime.stop();
    expect(phases).toEqual([
      "first start",
      "second start",
      "second stop",
      "first stop",
      "resources",
    ]);
  });

  it("continues shutdown after service failures and aggregates them with resource failures", async () => {
    const stopped: string[] = [];
    const feature = serverFeature<object>("owned")
      .withSetup(() => ({}))
      .withClose(() => {
        stopped.push("resource");
        throw new Error("resource");
      })
      .build();
    const runtime = await createApp({ role: "api", members: memberSourceOf({}) })
      .withService({
        name: "first",
        start: () => {},
        stop: () => {
          stopped.push("first");
          throw new Error("first");
        },
      })
      .withService({
        name: "second",
        start: () => {},
        stop: () => {
          stopped.push("second");
          throw new Error("second");
        },
      })
      .withModules([feature])
      .boot();
    await runtime.start();
    const stop = runtime.stop();
    await expect(stop).rejects.toBeInstanceOf(AggregateError);
    expect(runtime.stop()).toBe(stop);
    expect(stopped).toEqual(["second", "first", "resource"]);
  });
});
