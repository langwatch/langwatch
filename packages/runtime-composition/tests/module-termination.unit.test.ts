import { describe, expect, it } from "vitest";

import {
  defineServerModule,
  type FeatureSetup,
  type InstallableServerFeature,
  type ModuleConfigFor,
} from "../src/feature-installer.ts";
import { defineRepositories } from "../src/repository-registry.ts";

/**
 * The one termination rule, pinned in types.
 *
 * `withTransports`, `withWorkers`, `withTasks`, `withEventing` and
 * `withTransportFacts` all answer something a process can install as it
 * stands. `.build()` survives on that value as the identity, so an installer
 * written before that was true still compiles and still installs the same
 * module. Both spellings are asserted here, because a regression in either is
 * a regression in 49 installers at once.
 */

type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type Config = Readonly<{ suffix: string }>;
type Members = Readonly<{ prefix: string }>;

abstract class CatalogueApi {
  abstract read(): string;
}

class CatalogueApp extends CatalogueApi {
  static readonly contract = CatalogueApi;
  static readonly dependencies = {};
  static readonly reads = ["prefix"] as const;
  static readonly configSchema = {
    parse: (value: unknown): Config => ({ suffix: String((value as Config).suffix) }),
  };

  private constructor(private readonly label: string) {
    super();
  }

  static create(setup: FeatureSetup<typeof CatalogueApp.dependencies, Members, Config>) {
    return new CatalogueApp(`${setup.members.prefix}${setup.config.suffix}`);
  }

  read(): string {
    return this.label;
  }
}

const catalogueRest = {
  protocol: "rest",
  namespace: "dataset",
  router: () => ({ family: "dataset" }),
} as const;

const withoutBuild = defineServerModule("annotation")
  .withApp(CatalogueApp)
  .withTransports(catalogueRest);
const withBuild = defineServerModule("annotation")
  .withApp(CatalogueApp)
  .withTransports(catalogueRest)
  .build();

describe("given a module that states its doors", () => {
  describe("when it is spelled without a terminator", () => {
    it("is installable as it stands", () => {
      const installable: InstallableServerFeature<Members, "annotation", Config> = withoutBuild;

      expect(installable.name).toBe("annotation");
    });

    it("keeps its name a literal and its config slice its own", () => {
      type _name = Expect<Equal<(typeof withoutBuild)["name"], "annotation">>;
      type _config = Expect<
        Equal<ModuleConfigFor<[typeof withoutBuild]>, { readonly annotation: Config }>
      >;

      expect(withoutBuild.namespace).toBe("annotations");
    });

    it("keeps the transport tuple it was handed", () => {
      // A tuple, not an array: the length is the literal it was called with.
      type _length = Expect<Equal<(typeof withoutBuild)["transports"]["length"], 1>>;
      type _element = Expect<Equal<(typeof withoutBuild)["transports"][0], typeof catalogueRest>>;

      expect(withoutBuild.transports[0]).toBe(catalogueRest);
    });
  });

  describe("when it is spelled with the vestigial terminator", () => {
    it("infers exactly what the terminator-free spelling infers", () => {
      type _config = Expect<
        Equal<ModuleConfigFor<[typeof withBuild]>, ModuleConfigFor<[typeof withoutBuild]>>
      >;
      type _name = Expect<Equal<(typeof withBuild)["name"], (typeof withoutBuild)["name"]>>;
      type _transports = Expect<
        Equal<(typeof withBuild)["transports"], (typeof withoutBuild)["transports"]>
      >;
      const installable: InstallableServerFeature<Members, "annotation", Config> = withBuild;

      expect(installable.name).toBe("annotation");
    });

    it("answers the very value it was called on, so it installs the same module", () => {
      const terminated = withoutBuild.build();

      expect(terminated).toBe(withoutBuild);
      expect(terminated.build()).toBe(withoutBuild);
      expect(terminated.install).toBe(withoutBuild.install);
    });
  });

  describe("when it goes on to state the work another role owns", () => {
    it("stays installable through every further call", () => {
      const contributed = withoutBuild
        .withWorkers("consumer")
        .withTasks("backfill")
        .withTransportFacts(({ app, members }) => [
          { fact: "catalogueSize", read: () => `${members.prefix}${app.read()}` },
        ]);
      const installable: InstallableServerFeature<Members, "annotation", Config> = contributed;

      expect(installable.name).toBe("annotation");
      expect(contributed.workers).toEqual(["consumer"]);
      expect(contributed.tasks).toEqual(["backfill"]);
      expect(contributed.build()).toBe(contributed);
    });
  });
});

describe("given a module that owns repositories", () => {
  const registry = defineRepositories({
    live: { requires: [], create: () => ({ rows: () => 1 }) },
    memory: { requires: [], create: () => ({ rows: () => 0 }) },
  });

  class StoredApp extends CatalogueApi {
    static readonly contract = CatalogueApi;
    static readonly dependencies = {};
    static readonly reads = ["prefix"] as const;
    static readonly configSchema = CatalogueApp.configSchema;

    private constructor(private readonly rows: number) {
      super();
    }

    static create(
      setup: FeatureSetup<
        typeof StoredApp.dependencies,
        never,
        Config,
        Readonly<{ rows: () => number }>
      > &
        Readonly<{ members: Members }>,
    ) {
      return new StoredApp(setup.repositories.rows());
    }

    read(): string {
      return String(this.rows);
    }
  }

  const stored = defineServerModule("annotation")
    .withRepositories(registry)
    .withApp(StoredApp)
    .withTransports(catalogueRest);

  it("terminates the same way on the repository path", () => {
    type _config = Expect<
      Equal<ModuleConfigFor<[typeof stored]>, { readonly annotation: Config }>
    >;
    const installable: InstallableServerFeature<Members, "annotation", Config> = stored;

    expect(installable.name).toBe("annotation");
    expect(stored.build()).toBe(stored);
  });
});
