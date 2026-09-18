import { Config } from "@langwatch/config";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApp } from "../src/application.ts";
import { defineServerModule, type FeatureSetup } from "../src/feature-installer.ts";
import { memberSourceOf } from "./member-source.ts";

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
  /** Declared once; the process parse (§6) produces it, this app just reads it. */
  static readonly config = Config.define((c) => ({
    suffix: c.env("ANNOTATION_SUFFIX", z.string()),
  }));

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
  .withTransports(...directoryApis);

describe("defineServerModule", () => {
  it("constructs the declared app once during boot and publishes its contract", async () => {
    const runtime = await createApp({
      role: "api",
      config: { annotation: { suffix: "directory" } },
      members: memberSourceOf({ prefix: "tenant-" }),
    })
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

  it("keeps transport descriptors inert and preserves their tuple", () => {
    expect(directoryWithTransports.transports).toEqual(directoryApis);
    expect(directoryWithTransports.transports[0]).toBe(directoryApis[0]);
    expect(directoryWithTransports.transports[1]).toBe(directoryApis[1]);
    expect(directoryWithTransports.namespace).toBe("annotations");
    expect(directoryWithTransports.transports[0].protocol).toBe("rest");
  });
});
