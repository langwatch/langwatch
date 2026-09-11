import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/application.ts";
import { memberSourceOf } from "./member-source.ts";
import { defineServerModule, type FeatureSetup } from "../src/feature-installer.ts";

abstract class DirectoryApp {
  abstract readonly name: string;
}

type DeclaredMembers = Readonly<{ prefix: string }>;
type Config = Readonly<{ suffix: string }>;

class ComposedDirectoryApp extends DirectoryApp {
  static readonly contract = DirectoryApp;
  static readonly dependencies = {};
  /** The one member this app reads, and therefore the only one boot builds. */
  static readonly reads = ["prefix"] as const;
  static readonly configSchema = {
    parse(value: unknown): Config {
      if (!value || typeof value !== "object" || !("suffix" in value)) {
        throw new Error("suffix is required");
      }
      return { suffix: String(value.suffix) };
    },
  };

  private constructor(readonly name: string) {
    super();
  }

  static create(
    setup: FeatureSetup<typeof ComposedDirectoryApp.dependencies, DeclaredMembers, Config>,
  ): ComposedDirectoryApp {
    return new ComposedDirectoryApp(`${setup.members.prefix}${setup.config.suffix}`);
  }
}

const directoryServer = defineServerModule("annotation").withApp(ComposedDirectoryApp).build();
const directoryApis = [
  { protocol: "rest", router: (host: string) => ({ host }) },
  { protocol: "trpc", router: (host: string) => ({ host }) },
] as const;
const directoryWithTransports = defineServerModule("annotation")
  .withApp(ComposedDirectoryApp)
  .withTransports(...directoryApis)
  .build();

describe("defineServerModule", () => {
  it("constructs the declared app once during boot and publishes its contract", async () => {
    const runtime = await createApp({ role: "api", config: { annotation: { suffix: "directory" } }, members: memberSourceOf({ prefix: "tenant-" }) })
      .withModules([directoryServer])
      .boot();

    expect(runtime.service(DirectoryApp).name).toBe("tenant-directory");
    expect(runtime.module(directoryServer).provided).toBe(runtime.service(DirectoryApp));
  });

  it("passes the framework resource owner to the factory context", async () => {
    const own = vi.fn();
    class ResourceApp extends DirectoryApp {
      static readonly contract = DirectoryApp;
      static readonly dependencies = {};

      private constructor(readonly name = "resource") {
        super();
      }

      static create(
        setup: FeatureSetup<typeof ResourceApp.dependencies, DeclaredMembers, undefined>,
      ): ResourceApp {
        setup.resources.own("resource", own);
        return new ResourceApp();
      }
    }

    const declaration = defineServerModule("presence").withApp(ResourceApp).build();
    const runtime = await createApp({ role: "api", members: memberSourceOf({ prefix: "unused" }) })
      .withModules([declaration])
      .boot();

    await runtime.stop();
    expect(own).toHaveBeenCalledOnce();
  });

  it("validates semantic config before invoking the app factory", async () => {
    const create = vi.fn(ComposedDirectoryApp.create);
    const app = { ...ComposedDirectoryApp, create };
    const declaration = defineServerModule("annotation").withApp(app).build();

    await expect(
      createApp({ role: "api", config: { annotation: {} }, members: memberSourceOf({ prefix: "unused" }) })
        // The config slice is deliberately incomplete, and ModuleConfigGuard is
        // right to refuse it where it can see it. This test covers the refusal
        // that still has to hold when it cannot: config reaching boot from JSON,
        // the environment or a process config file was never type-checked, so
        // the runtime parse stays the load-bearing one.
        // @ts-expect-error - the compile-time refusal is asserted by this directive
        .withModules([declaration])
        .boot(),
    ).rejects.toThrow("suffix is required");
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps transport descriptors inert and preserves their tuple", () => {
    expect(directoryWithTransports.transports).toEqual(directoryApis);
    expect(directoryWithTransports.transports[0]).toBe(directoryApis[0]);
    expect(directoryWithTransports.transports[1]).toBe(directoryApis[1]);
    expect(directoryWithTransports.namespace).toBe("annotations");
    expect(directoryWithTransports.transports[0].protocol).toBe("rest");
  });
});
