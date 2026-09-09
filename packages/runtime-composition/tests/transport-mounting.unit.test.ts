import { describe, expect, it } from "vitest";

import { createApp } from "../src/application.ts";
import { featureApi } from "../src/feature-api-token.ts";
import { defineFeature, type FeatureSetup } from "../src/feature-installer.ts";
import {
  DuplicateTransportNamespaceError,
  MissingTransportHostError,
  type FeatureRestHost,
  type FeatureTrpcHost,
} from "../src/transport-mounting.ts";

interface CatalogueApi {
  read(): string;
}
const CatalogueApi = featureApi<CatalogueApi>("dataset");

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

/** One declared family, standing in for a REST declaration builder's output. */
const catalogueRest = {
  protocol: "rest",
  namespace: "dataset",
  router: () => ({ family: "dataset" }),
} as const;

/** One declared namespace, standing in for a tRPC declaration. */
const catalogueTrpc = {
  protocol: "trpc",
  namespace: "dataset",
  router: () => ({ procedures: ["getAll"] }),
} as const;

type MountedRest = Readonly<{
  declaration: object;
  app: unknown;
  options: Readonly<{ onError?: unknown; facts?: readonly unknown[] }> | undefined;
}>;

/** A process's REST door, recording every mount it was asked for. */
function recordingRestHost(): FeatureRestHost<MountedRest> & { mounted: MountedRest[] } {
  const mounted: MountedRest[] = [];

  return {
    mounted,
    mount: (declaration, app, options) => {
      const record = { declaration, app: app(), options };
      mounted.push(record);

      return record;
    },
  };
}

/** A process's tRPC root, answering the namespace it was handed. */
function recordingTrpcHost(): FeatureTrpcHost<Readonly<{ app: unknown }>> {
  return { mount: (_declaration, app) => ({ app: app() }) };
}

describe("given a feature whose server declares transports", () => {
  describe("when the application was handed the process's own doors", () => {
    it("mounts every declared family on the REST door", async () => {
      const server = defineFeature("dataset")
        .withApp(CatalogueApp)
        .withTransports(catalogueRest)
        .build();
      const rest = recordingRestHost();

      const runtime = await createApp({ name: "test" })
        .withInfrastructure({})
        .withTransports({ rest })
        .withFeature(server)
        .boot({ role: "api" });

      expect(runtime.transports.rest).toHaveLength(1);
      expect(rest.mounted[0]?.declaration).toEqual({ family: "dataset" });
    });

    it("binds the handler's application to the feature's own app", async () => {
      const server = defineFeature("dataset")
        .withApp(CatalogueApp)
        .withTransports(catalogueTrpc)
        .build();

      const runtime = await createApp({ name: "test" })
        .withInfrastructure({})
        .withTransports({ trpc: recordingTrpcHost() })
        .withFeature(server)
        .boot({ role: "api" });

      const mounted = runtime.transports.trpc.dataset;

      expect((mounted?.app as CatalogueApi).read()).toBe("one dataset");
    });

    it("keys each mounted namespace by the name its declaration carries", async () => {
      const server = defineFeature("dataset")
        .withApp(CatalogueApp)
        .withTransports(catalogueTrpc)
        .build();

      const runtime = await createApp({ name: "test" })
        .withInfrastructure({})
        .withTransports({ trpc: recordingTrpcHost() })
        .withFeature(server)
        .boot({ role: "api" });

      expect(Object.keys(runtime.transports.trpc)).toEqual(["dataset"]);
    });

    it("passes the install's facts and error boundary to the mount", async () => {
      const server = defineFeature("dataset")
        .withApp(CatalogueApp)
        .withTransports(catalogueRest)
        .build();
      const rest = recordingRestHost();
      const onError = () => new Response(null, { status: 500 });
      const fact = { fact: { name: "callerEmail" } };

      await createApp({ name: "test" })
        .withInfrastructure({})
        .withTransports({ rest })
        .withFeature(server, { facts: [fact], rest: { onError } })
        .boot({ role: "api" });

      expect(rest.mounted[0]?.options).toEqual({ onError, facts: [fact] });
    });
  });

  describe("when the process opened no door for a declared protocol", () => {
    it("refuses at boot, naming the feature and the protocol", async () => {
      const server = defineFeature("dataset")
        .withApp(CatalogueApp)
        .withTransports(catalogueTrpc)
        .build();

      await expect(
        createApp({ name: "test" })
          .withInfrastructure({})
          .withTransports({ rest: recordingRestHost() })
          .withFeature(server)
          .boot({ role: "api" }),
      ).rejects.toThrow(MissingTransportHostError);
    });
  });

  describe("when two installed features claim one namespace", () => {
    it("refuses at boot, naming both", async () => {
      const dataset = defineFeature("dataset")
        .withApp(CatalogueApp)
        .withTransports(catalogueTrpc)
        .build();
      const monitor = defineFeature("monitor")
        .withApp(
          class MonitorApp {
            static readonly contract = featureApi<CatalogueApi>("monitor");
            static readonly dependencies = {};
            static create(): CatalogueApi {
              return { read: () => "one monitor" };
            }
          },
        )
        .withTransports(catalogueTrpc)
        .build();

      await expect(
        createApp({ name: "test" })
          .withInfrastructure({})
          .withTransports({ trpc: recordingTrpcHost() })
          .withFeature(dataset)
          .withFeature(monitor)
          .boot({ role: "api" }),
      ).rejects.toThrow(DuplicateTransportNamespaceError);
    });
  });

  describe("when the same feature is installed on a worker", () => {
    it("mounts nothing, because a worker serves no door", async () => {
      const server = defineFeature("dataset")
        .withApp(CatalogueApp)
        .withTransports(catalogueRest, catalogueTrpc)
        .build();
      const rest = recordingRestHost();

      const runtime = await createApp({ name: "test" })
        .withInfrastructure({})
        .withTransports({ rest })
        .withFeature(server)
        .boot({ role: "worker" });

      expect(runtime.transports).toEqual({ rest: [], trpc: {} });
      expect(rest.mounted).toHaveLength(0);
    });
  });
});
