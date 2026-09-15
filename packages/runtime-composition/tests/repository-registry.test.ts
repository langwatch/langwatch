import { describe, expect, it } from "vitest";
import {
  createApp,
  defineServerModule,
  defineRepositories,
  withMemoryRepositories,
  type FeatureSetup,
} from "../src/index.ts";
import { instantiateRepositories, selectedRepositoryOwnership } from "../src/repository-registry.ts";
import { RepositoryOwnershipConflictError } from "../src/repository-ownership.ts";
import { MissingMemberError } from "../src/module-members.ts";
import { memberSourceOf } from "./member-source.ts";

type Repositories = Readonly<{ value: { read(): string } }>;
let liveCreates = 0;
let memoryCreates = 0;

class LiveRepositories {
  static readonly requires = ["prisma"] as const;
  static create({ prisma }: { prisma: { prefix: string } }): Repositories {
    liveCreates += 1;
    return { value: { read: () => prisma.prefix } };
  }
}

class MemoryRepositories {
  static readonly requires = [] as const;
  static create(): Repositories {
    memoryCreates += 1;
    return { value: { read: () => "memory" } };
  }
}

const repositories = defineRepositories({ live: LiveRepositories, memory: MemoryRepositories });

class App {
  static readonly contract = App;
  static readonly dependencies = {};
  static readonly configSchema = { parse: () => undefined };
  static create({
    repositories,
  }: FeatureSetup<Record<never, never>, never, undefined, Repositories>): App {
    return new App(repositories.value.read());
  }
  constructor(readonly value: string) {}
}

class ConfiguredApp {
  static readonly contract = ConfiguredApp;
  static readonly dependencies = {};
  static readonly reads = ["suffix"] as const;
  static readonly configSchema = {
    parse(value: unknown): { prefix: string } {
      if (value === null || typeof value !== "object") throw new Error("prefix is required");
      if (!("prefix" in value) || typeof value.prefix !== "string")
        throw new Error("prefix is required");
      return { prefix: value.prefix };
    },
  };
  static create({
    repositories,
    members,
    config,
  }: FeatureSetup<
    Record<never, never>,
    { suffix: string },
    { prefix: string },
    Repositories
  >): ConfiguredApp {
    return new ConfiguredApp(`${config.prefix}:${repositories.value.read()}:${members.suffix}`);
  }
  constructor(readonly value: string) {}
}

const feature = defineServerModule("annotation").withRepositories(repositories).withApp(App).build();
const configuredFeature = defineServerModule("agent")
  .withRepositories(repositories)
  .withApp(ConfiguredApp)
  .build();

let duplicateCreates = 0;

class DuplicateRepositories {
  static readonly requires = [] as const;
  static readonly repositories = {
    value: { tables: { store: "postgres", tables: ["SharedTable"] } },
  };
  static create(): Repositories {
    duplicateCreates += 1;
    return { value: { read: () => "duplicate" } };
  }
}

class DuplicateApp {
  static readonly contract = DuplicateApp;
  static readonly dependencies = {};
  static create({
    repositories,
  }: FeatureSetup<Record<never, never>, never, undefined, Repositories>): DuplicateApp {
    return new DuplicateApp(repositories.value.read());
  }
  constructor(readonly value: string) {}
}

const duplicateRepositories = defineRepositories({
  live: DuplicateRepositories,
  memory: DuplicateRepositories,
});
const duplicateFeature = defineServerModule("project")
  .withRepositories(duplicateRepositories)
  .withApp(DuplicateApp)
  .build();

class CanonicalPrismaRepositories {
  static readonly requires = [] as const;
  static readonly repositories = {
    value: { tables: { store: "prisma", tables: ["SharedTable"] } },
  };
  static create(): Repositories {
    duplicateCreates += 1;
    return { value: { read: () => "canonical" } };
  }
}

const canonicalPrismaRepositories = defineRepositories({
  live: CanonicalPrismaRepositories,
  memory: CanonicalPrismaRepositories,
});
const canonicalPrismaFeature = defineServerModule("user")
  .withRepositories(canonicalPrismaRepositories)
  .withApp(DuplicateApp)
  .build();

describe("given a module that declares both repository tiers", () => {
  describe("when the registry is defined", () => {
    it("captures the factories and metadata against later mutation", () => {
      class MutableProvider {
        static readonly #value = "original";
        static readonly requires = [] as const;
        static repositories = { value: { tables: { store: "postgres", tables: ["Original"] } } };
        static create(): Repositories {
          return { value: { read: () => this.#value } };
        }
      }
      const captured = defineRepositories({ live: MutableProvider, memory: MutableProvider });
      Object.defineProperty(MutableProvider, "requires", { value: ["unexpected"] });
      MutableProvider.repositories.value.tables.tables.push("Unclaimed");
      MutableProvider.create = () => ({ value: { read: () => "replaced" } });

      const selection = { tier: "memory", members: {} } as const;
      expect(instantiateRepositories(captured, selection).value.read()).toBe("original");
      expect(selectedRepositoryOwnership(captured, selection)).toEqual({
        value: { tables: { store: "postgres", tables: ["Original"] } },
      });
      expect(Reflect.set(captured.definitions, "memory", MemoryRepositories)).toBe(false);
      expect(Reflect.set(captured.definitions.memory, "create", MemoryRepositories.create)).toBe(
        false,
      );
    });
  });

  describe("when the process installs it as declared", () => {
    it("builds the live tier over the member that tier requires", async () => {
      liveCreates = 0;
      memoryCreates = 0;
      const runtime = await createApp({
        role: "api",
        members: memberSourceOf({ prisma: { prefix: "postgres" } }),
      })
        .withModules([feature])
        .boot();

      expect(runtime.module(feature).provided.value).toBe("postgres");
      expect(liveCreates).toBe(1);
      expect(memoryCreates).toBe(0);
      await runtime.stop();
    });

    it("hands the app its config, the members it reads and the live repositories", async () => {
      const runtime = await createApp({
        role: "api",
        config: { agent: { prefix: "config" } },
        members: memberSourceOf({ suffix: "infra", prisma: { prefix: "database" } }),
      })
        .withModules([configuredFeature])
        .boot();

      expect(runtime.module(configuredFeature).provided.value).toBe("config:database:infra");
      await runtime.stop();
    });
  });

  describe("when the caller asks for the memory repositories in code", () => {
    /** @scenario "Memory is a choice a caller makes in code" */
    it("builds the memory tier and asks for no client at all", async () => {
      liveCreates = 0;
      memoryCreates = 0;
      const runtime = await createApp({ role: "api", members: memberSourceOf({}) })
        .withModules([withMemoryRepositories(feature)])
        .boot();

      expect(runtime.module(feature).provided.value).toBe("memory");
      expect(liveCreates).toBe(0);
      expect(memoryCreates).toBe(1);
      await runtime.stop();
    });

    it("refuses on a module that declares no repositories at all", () => {
      class StorelessApp {
        static readonly contract = StorelessApp;
        static readonly dependencies = {};
        static create(): StorelessApp {
          return new StorelessApp();
        }
      }
      const plain = defineServerModule("share").withApp(StorelessApp).build();

      expect(() => withMemoryRepositories(plain)).toThrow("has no memory tier");
    });
  });

  describe("when the store the live tier needs has no address", () => {
    /** @scenario "A store with no address refuses at boot" */
    it("refuses naming the module and the member, before any factory runs", async () => {
      liveCreates = 0;
      const booting = createApp({ role: "api", members: memberSourceOf({}) })
        .withModules([feature])
        .boot();

      await expect(booting).rejects.toBeInstanceOf(MissingMemberError);
      await expect(booting).rejects.toMatchObject({ module: "annotation", member: "prisma" });
      expect(liveCreates).toBe(0);
    });

    it("refuses rather than falling back to the memory tier", async () => {
      memoryCreates = 0;
      await expect(
        createApp({ role: "api", members: memberSourceOf({}) })
          .withModules([feature])
          .boot(),
      ).rejects.toBeInstanceOf(MissingMemberError);

      expect(memoryCreates).toBe(0);
    });

    it("refuses a member the source names but cannot build", async () => {
      const booting = createApp({
        role: "api",
        members: memberSourceOf({ prisma: undefined as unknown as { prefix: string } }),
      })
        .withModules([feature])
        .boot();

      await expect(booting).rejects.toMatchObject({ module: "annotation", member: "prisma" });
    });
  });

  describe("when two selected tiers claim the same table", () => {
    it("refuses before either repository factory runs", async () => {
      duplicateCreates = 0;
      const conflictingFeature = defineServerModule("user")
        .withRepositories(duplicateRepositories)
        .withApp(DuplicateApp)
        .build();

      await expect(
        createApp({ role: "api", members: memberSourceOf({}) })
          .withModules([duplicateFeature, conflictingFeature])
          .boot(),
      ).rejects.toThrow(RepositoryOwnershipConflictError);
      expect(duplicateCreates).toBe(0);
    });

    it("reads a canonical Prisma claim as a Postgres claim", async () => {
      duplicateCreates = 0;

      await expect(
        createApp({ role: "api", members: memberSourceOf({}) })
          .withModules([duplicateFeature, canonicalPrismaFeature])
          .boot(),
      ).rejects.toBeInstanceOf(RepositoryOwnershipConflictError);
      expect(duplicateCreates).toBe(0);
    });
  });

  describe("when the app declares no config schema", () => {
    it("keeps the static create method the class carries", async () => {
      class MethodApp {
        static readonly contract = MethodApp;
        static readonly dependencies = {};
        static create({
          repositories,
        }: FeatureSetup<Record<never, never>, never, undefined, Repositories>): MethodApp {
          return new MethodApp(repositories.value.read());
        }
        constructor(readonly value: string) {}
      }
      const methodFeature = defineServerModule("share")
        .withRepositories(repositories)
        .withApp(MethodApp)
        .build();

      const runtime = await createApp({ role: "api", members: memberSourceOf({}) })
        .withModules([withMemoryRepositories(methodFeature)])
        .boot();

      expect(runtime.module(methodFeature).provided.value).toBe("memory");
      await runtime.stop();
    });
  });
});
