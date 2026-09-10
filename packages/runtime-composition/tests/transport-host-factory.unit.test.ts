import { describe, expect, it } from "vitest";

import { createApp } from "../src/application.ts";
import { memberSourceOf } from "./member-source.ts";
import { moduleApi } from "../src/module-api-token.ts";
import { defineServerModule, type FeatureSetup } from "../src/feature-installer.ts";
import { MissingTransportPeerError, type TransportPeers } from "../src/transport-peers.ts";
import type { FeatureRestHost } from "../src/transport-mounting.ts";

interface CatalogueApi {
  read(): string;
}
const CatalogueApi = moduleApi<CatalogueApi>("dataset");

class CatalogueApp implements CatalogueApi {
  static readonly contract = CatalogueApi;
  static readonly dependencies = {};

  static create(_setup: FeatureSetup<Record<never, never>, object, undefined>): CatalogueApi {
    return new CatalogueApp();
  }

  read(): string {
    return "one dataset";
  }
}

const MissingApi = moduleApi<{ read(): string }>("annotation");

const catalogueRest = {
  protocol: "rest",
  namespace: "dataset",
  router: () => ({ family: "dataset" }),
} as const;

type MountedRest = Readonly<{ declaration: object; door: string }>;

/** A door built from what a peer App answered, the way the api's own doors are. */
function doorFrom(peers: TransportPeers): FeatureRestHost<MountedRest> {
  const catalogue = peers.app(CatalogueApi);

  return { mount: (declaration) => ({ declaration, door: catalogue.read() }) };
}

const datasetModule = defineServerModule("dataset")
  .withApp(CatalogueApp)
  .withTransports(catalogueRest)
  .build();

describe("given a process whose doors are built from its own modules", () => {
  describe("when the application names its doors as a factory", () => {
    it("runs the factory once every module's app is resolved", async () => {
      const runtime = await createApp({ role: "api", members: memberSourceOf({}) })
        .withTransports((peers) => ({ rest: doorFrom(peers) }))
        .withModules([datasetModule])
        .boot();

      expect(runtime.transports.rest).toEqual([
        { declaration: { family: "dataset" }, door: "one dataset" },
      ]);
    });

    it("runs it before anything is mounted, so no door reads a half-built graph", async () => {
      const order: string[] = [];
      const runtime = await createApp({ role: "api", members: memberSourceOf({}) })
        .withTransports((peers) => {
          order.push("doors built");
          const catalogue = peers.app(CatalogueApi);

          return {
            rest: {
              mount: (declaration) => {
                order.push("family mounted");
                return { declaration, door: catalogue.read() };
              },
            },
          };
        })
        .withModules([datasetModule])
        .boot();

      expect(order).toEqual(["doors built", "family mounted"]);
      expect(runtime.transports.rest).toHaveLength(1);
    });

    it("answers nothing for a peer this build installed no module for", async () => {
      let found: unknown = "unset";
      await createApp({ role: "api", members: memberSourceOf({}) })
        .withTransports((peers) => {
          found = peers.find(MissingApi);
          return {};
        })
        .withModules([datasetModule])
        .boot();

      expect(found).toBeUndefined();
    });

    it("refuses by token when a door is built from a module this build never installed", async () => {
      const booting = createApp({ role: "api", members: memberSourceOf({}) })
        .withTransports((peers) => ({ rest: doorFrom(peers) }))
        .withModules([])
        .boot();

      await expect(booting).rejects.toThrow(MissingTransportPeerError);
      await expect(booting).rejects.toThrow(/dataset/);
    });

    it("never runs the factory in a role that serves no door", async () => {
      let ran = false;
      await createApp({ role: "worker", members: memberSourceOf({}) })
        .withTransports(() => {
          ran = true;
          return {};
        })
        .withModules([datasetModule])
        .boot();

      expect(ran).toBe(false);
    });
  });
});
