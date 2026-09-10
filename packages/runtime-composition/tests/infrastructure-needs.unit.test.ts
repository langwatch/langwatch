import { describe, expect, expectTypeOf, it } from "vitest";

import { createApp } from "../src/application.ts";
import { defineServerModule, type FeatureSetup } from "../src/feature-installer.ts";
import { MissingInfrastructureError, type NeedsResult } from "../src/infrastructure-needs.ts";

abstract class DirectoryApp {
  abstract readonly name: string;
}

/** The two pool members this module names, and nothing else. */
type DirectoryInfrastructure = Readonly<{ prefix: string; clock: () => number }>;

class ComposedDirectoryApp extends DirectoryApp {
  static readonly contract = DirectoryApp;
  static readonly dependencies = {};

  private constructor(readonly name: string) {
    super();
  }

  static create(
    setup: FeatureSetup<
      typeof ComposedDirectoryApp.dependencies,
      DirectoryInfrastructure,
      undefined
    >,
  ): ComposedDirectoryApp {
    return new ComposedDirectoryApp(
      `${setup.infrastructure.prefix}${setup.infrastructure.clock()}`,
    );
  }
}

const directoryServer = defineServerModule("annotation")
  .needs<DirectoryInfrastructure>()("prefix", "clock")
  .withApp(ComposedDirectoryApp)
  .build();

describe("given a module that names the pool members it reads", () => {
  describe("when the pool supplies every member", () => {
    /** @scenario "A module names the pool members it reads" */
    it("boots and hands the app the pool", async () => {
      const runtime = await createApp({ name: "test" })
        .withInfrastructure({ prefix: "a-", clock: () => 1 })
        .withModules([directoryServer])
        .boot({ role: "api" });

      expect(runtime.service(DirectoryApp).name).toBe("a-1");
    });
  });

  describe("when the pool supplies a named member as undefined", () => {
    /** @scenario "A pool member the module named is absent at boot" */
    it("refuses to boot naming the module and the member", async () => {
      const booting = createApp({ name: "test" })
        .withInfrastructure({ prefix: "a-", clock: undefined as unknown as () => number })
        .withModules([directoryServer])
        .boot({ role: "api" });

      await expect(booting).rejects.toThrowError(MissingInfrastructureError);
      await expect(booting).rejects.toMatchObject({ module: "annotation", member: "clock" });
    });
  });

  describe("when the named members do not cover the interface", () => {
    /** @scenario "The named members do not cover the module's interface" */
    it("resolves to a type that names what is missing", () => {
      expectTypeOf<NeedsResult<DirectoryInfrastructure, ["prefix"], "builder">>().toEqualTypeOf<
        ["missing infrastructure members", "clock"]
      >();
      expectTypeOf<
        NeedsResult<DirectoryInfrastructure, ["prefix", "clock"], "builder">
      >().toEqualTypeOf<"builder">();
    });
  });
});
