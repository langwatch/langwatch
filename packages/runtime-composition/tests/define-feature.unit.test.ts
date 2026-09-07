import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/application.ts";
import { defineFeature, type FeatureSetup } from "../src/feature-installer.ts";

abstract class DirectoryApp {
  abstract readonly name: string;
}

type Infrastructure = Readonly<{ prefix: string }>;
type Config = Readonly<{ suffix: string }>;

class ComposedDirectoryApp extends DirectoryApp {
  static readonly contract = DirectoryApp;
  static readonly dependencies = {};
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
    setup: FeatureSetup<typeof ComposedDirectoryApp.dependencies, Infrastructure, Config>,
  ): ComposedDirectoryApp {
    return new ComposedDirectoryApp(`${setup.infrastructure.prefix}${setup.config.suffix}`);
  }
}

const directoryServer = defineFeature("annotation").withApp(ComposedDirectoryApp).build();
const directoryApis = [
  { protocol: "rest", router: (host: string) => ({ host }) },
  { protocol: "trpc", router: (host: string) => ({ host }) },
] as const;
const directoryWithTransports = defineFeature("annotation")
  .withApp(ComposedDirectoryApp)
  .withTransports(...directoryApis)
  .build();

describe("defineFeature", () => {
  it("constructs the declared app once during boot and publishes its contract", async () => {
    const runtime = await createApp({ name: "test" })
      .withInfrastructure({ prefix: "tenant-" })
      .withFeature(directoryServer)
      .boot({ role: "api", config: { annotation: { suffix: "directory" } } });

    expect(runtime.service(DirectoryApp).name).toBe("tenant-directory");
    expect(runtime.feature(directoryServer).provided).toBe(runtime.service(DirectoryApp));
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
        setup: FeatureSetup<typeof ResourceApp.dependencies, Infrastructure, undefined>,
      ): ResourceApp {
        setup.resources.own("resource", own);
        return new ResourceApp();
      }
    }

    const declaration = defineFeature("presence").withApp(ResourceApp).build();
    const runtime = await createApp({ name: "test" })
      .withInfrastructure({ prefix: "unused" })
      .withFeature(declaration)
      .boot({ role: "api" });

    await runtime.stop();
    expect(own).toHaveBeenCalledOnce();
  });

  it("validates semantic config before invoking the app factory", async () => {
    const create = vi.fn(ComposedDirectoryApp.create);
    const app = { ...ComposedDirectoryApp, create };
    const declaration = defineFeature("annotation").withApp(app).build();

    await expect(
      createApp({ name: "test" })
        .withInfrastructure({ prefix: "unused" })
        .withFeature(declaration)
        .boot({ role: "api", config: { annotation: {} } }),
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
