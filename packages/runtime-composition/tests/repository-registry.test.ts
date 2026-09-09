import { describe, expect, it } from "vitest";
import { createApp, defineModule, defineRepositories, type FeatureSetup } from "../src/index.ts";
import {
  instantiateRepositories,
  selectedRepositoryOwnership,
} from "../src/repository-registry.ts";
import { RepositoryOwnershipConflictError } from "../src/repository-ownership.ts";

type Repositories = Readonly<{ value: { read(): string } }>;
let postgresCreates = 0;
let memoryCreates = 0;

class PostgresRepositories {
  static readonly requires = ["prisma"] as const;
  static create({ prisma }: { prisma: { prefix: string } }): Repositories {
    postgresCreates += 1;
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

const repositories = defineRepositories({
  postgres: PostgresRepositories,
  memory: MemoryRepositories,
});

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
    infrastructure,
    config,
  }: FeatureSetup<
    Record<never, never>,
    { suffix: string },
    { prefix: string },
    Repositories
  >): ConfiguredApp {
    return new ConfiguredApp(
      `${config.prefix}:${repositories.value.read()}:${infrastructure.suffix}`,
    );
  }
  constructor(readonly value: string) {}
}

const feature = defineModule("annotation").withRepositories(repositories).withApp(App).build();
const configuredFeature = defineModule("agent")
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

const duplicateRepositories = defineRepositories({ postgres: DuplicateRepositories });
const duplicateFeature = defineModule("project")
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

const canonicalPrismaRepositories = defineRepositories({ postgres: CanonicalPrismaRepositories });
const canonicalPrismaFeature = defineModule("user")
  .withRepositories(canonicalPrismaRepositories)
  .withApp(DuplicateApp)
  .build();

describe("repository registries", () => {
  it("captures backend metadata and factories while preserving their original receiver", () => {
    class MutableProvider {
      static readonly #value = "original";
      static readonly requires = [] as const;
      static repositories = { value: { tables: { store: "postgres", tables: ["Original"] } } };
      static create(): Repositories {
        return { value: { read: () => this.#value } };
      }
    }
    const definitions = { memory: MutableProvider };
    const captured = defineRepositories(definitions);
    Object.defineProperty(MutableProvider, "requires", { value: ["unexpected"] });
    MutableProvider.repositories.value.tables.tables.push("Unclaimed");
    MutableProvider.create = () => ({ value: { read: () => "replaced" } });

    const selection = { backend: "memory" as const, infrastructure: {} };
    expect(instantiateRepositories(captured, selection).value.read()).toBe("original");
    expect(selectedRepositoryOwnership(captured, selection)).toEqual({
      value: { tables: { store: "postgres", tables: ["Original"] } },
    });
    expect(Reflect.set(captured.definitions, "memory", MemoryRepositories)).toBe(false);
    expect(Reflect.set(captured.definitions.memory, "create", MemoryRepositories.create)).toBe(
      false,
    );
  });

  it("passes parsed config and process infrastructure when a worker selects memory", async () => {
    const runtime = await createApp({ name: "configured-worker" })
      .withPersistence("memory", {})
      .withInfrastructure({ suffix: "worker" })
      .withModule(configuredFeature)
      .boot({ role: "worker", config: { agent: { prefix: "config" } } });

    expect(runtime.module(configuredFeature).provided.value).toBe("config:memory:worker");
    await runtime.stop();
  });

  it("passes parsed config, process infrastructure, and selected repositories to a configured app", async () => {
    const runtime = await createApp({ name: "configured" })
      .withPersistence("postgres", { prisma: { prefix: "database" } })
      .withInfrastructure({ suffix: "infra" })
      .withModule(configuredFeature)
      .boot({ role: "api", config: { agent: { prefix: "config" } } });
    expect(runtime.module(configuredFeature).provided.value).toBe("config:database:infra");
    await runtime.stop();
  });

  it("selects one complete backend bundle at boot", async () => {
    postgresCreates = 0;
    memoryCreates = 0;
    const runtime = await createApp({ name: "postgres" })
      .withPersistence("postgres", { prisma: { prefix: "postgres" } })
      .withInfrastructure({})
      .withModule(feature)
      .boot({ role: "api" });
    expect(runtime.module(feature).provided.value).toBe("postgres");
    expect(postgresCreates).toBe(1);
    expect(memoryCreates).toBe(0);
    await runtime.stop();
  });

  it("selects the memory bundle without touching postgres", async () => {
    postgresCreates = 0;
    memoryCreates = 0;
    const runtime = await createApp({ name: "memory" })
      .withPersistence("memory", {})
      .withInfrastructure({})
      .withModule(feature)
      .boot({ role: "api" });
    expect(runtime.module(feature).provided.value).toBe("memory");
    expect(postgresCreates).toBe(0);
    expect(memoryCreates).toBe(1);
    await runtime.stop();
  });

  it("keeps a static create method on an app class that declares no config schema", async () => {
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
    const methodFeature = defineModule("share")
      .withRepositories(repositories)
      .withApp(MethodApp)
      .build();

    const runtime = await createApp({ name: "method" })
      .withPersistence("memory", {})
      .withInfrastructure({})
      .withModule(methodFeature)
      .boot({ role: "api" });

    expect(runtime.module(methodFeature).provided.value).toBe("memory");
    await runtime.stop();
  });

  it("rejects missing persistence infrastructure before construction", async () => {
    postgresCreates = 0;
    await expect(
      createApp({ name: "missing" })
        .withPersistence("postgres", {})
        .withInfrastructure({})
        .withModule(feature)
        .boot({ role: "api" }),
    ).rejects.toThrow('requires infrastructure "prisma"');
    expect(postgresCreates).toBe(0);
  });

  it("rejects inherited and null persistence values before construction", async () => {
    postgresCreates = 0;
    const inherited: Record<string, unknown> = Object.create({ prisma: { prefix: "inherited" } });
    for (const infrastructure of [inherited, { prisma: null }]) {
      await expect(
        createApp({ name: "invalid" })
          .withPersistence("postgres", infrastructure)
          .withInfrastructure({})
          .withModule(feature)
          .boot({ role: "api" }),
      ).rejects.toThrow('requires infrastructure "prisma"');
    }
    expect(postgresCreates).toBe(0);
  });

  it("rejects selected duplicate table claims before either repository factory runs", async () => {
    duplicateCreates = 0;
    const conflictingFeature = defineModule("user")
      .withRepositories(duplicateRepositories)
      .withApp(DuplicateApp)
      .build();
    await expect(
      createApp({ name: "duplicate-ownership" })
        .withPersistence("postgres", {})
        .withInfrastructure({})
        .withModule(duplicateFeature)
        .withModule(conflictingFeature)
        .boot({ role: "api" }),
    ).rejects.toThrow(RepositoryOwnershipConflictError);
    expect(duplicateCreates).toBe(0);
  });

  it("treats canonical Prisma claims as Postgres claims before factories run", async () => {
    duplicateCreates = 0;
    await expect(
      createApp({ name: "canonical-prisma-conflict" })
        .withPersistence("postgres", {})
        .withInfrastructure({})
        .withModule(duplicateFeature)
        .withModule(canonicalPrismaFeature)
        .boot({ role: "api" }),
    ).rejects.toBeInstanceOf(RepositoryOwnershipConflictError);
    expect(duplicateCreates).toBe(0);
  });
});
