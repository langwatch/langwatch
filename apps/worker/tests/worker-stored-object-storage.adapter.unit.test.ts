const { client, resolver } = vi.hoisted(() => ({
  client: {
    send: vi.fn(),
  },
  resolver: {
    hosts: [] as string[],
  },
}));

vi.mock("@aws-sdk/client-s3", () => ({
  DeleteObjectCommand: class {
    constructor(_input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(_input: unknown) {}
  },
  HeadObjectCommand: class {
    constructor(_input: unknown) {}
  },
  PutObjectCommand: class {
    constructor(_input: unknown) {}
  },
  S3Client: class {
    send = client.send;
  },
}));

import { AwsClientProcessRuntime, OutboundProxyResolverPort } from "@langwatch/aws-client";
import { describe, expect, it, vi } from "vitest";
import {
  WorkerAzureStorageFactoryPort,
  WorkerProjectS3SourcePort,
  WorkerStoredObjectStorageRuntimeFactory,
} from "../src/platform/infrastructure/worker-stored-object-storage.adapter";

class ProjectSource extends WorkerProjectS3SourcePort {
  constructor(
    private readonly target: {
      bucket: string;
      endpoint?: string;
      region?: string;
    } | null,
  ) {
    super();
  }

  async tryGet() {
    return this.target;
  }
}

class AzureFactory extends WorkerAzureStorageFactoryPort {
  destinationCalls = 0;
  driverCalls = 0;

  resolve() {
    this.destinationCalls += 1;
    return { accountName: "account", container: "container" };
  }

  createDriver() {
    this.driverCalls += 1;
    return {
      put: async () => undefined,
      get: async () => {
        throw new Error("not implemented");
      },
      delete: async () => undefined,
      exists: async () => false,
    };
  }
}

class RecordingProxy extends OutboundProxyResolverPort {
  tryResolveForHost(hostname: string): string | undefined {
    resolver.hosts.push(hostname);
    return undefined;
  }
}

describe("Worker stored object storage composition", () => {
  it("keeps BYOC ahead of Azure without constructing its lazy driver", async () => {
    const azure = new AzureFactory();
    const runtime = WorkerStoredObjectStorageRuntimeFactory.create({
      config: {
        backend: "azure",
        localFilesystemRoot: "/objects",
        azure,
      },
      projects: new ProjectSource({ bucket: "project-bucket" }),
    }).createRuntime();
    const aws = AwsClientProcessRuntime.create({ outboundProxy: new RecordingProxy() });

    await expect(runtime.forProject("project-1", aws).resolveDestination()).resolves.toEqual({
      kind: "s3",
      bucket: "project-bucket",
    });
    expect(azure.destinationCalls).toBe(0);
    expect(azure.driverCalls).toBe(0);
    await aws.close();
  });

  it("constructs Azure only for an Azure URI and routes S3 through the process AWS runtime", async () => {
    client.send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    resolver.hosts.length = 0;
    const azure = new AzureFactory();
    const runtime = WorkerStoredObjectStorageRuntimeFactory.create({
      config: {
        backend: "s3",
        localFilesystemRoot: "/objects",
        globalS3: { bucket: "global", endpoint: "https://minio.example.test" },
        azure,
      },
      projects: new ProjectSource(null),
    }).createRuntime();
    const aws = AwsClientProcessRuntime.create({ outboundProxy: new RecordingProxy() });
    const storage = runtime.forProject("project-1", aws).objectStore;

    await expect(storage.get("azure-blob://account/container/object")).rejects.toThrow(
      "not implemented",
    );
    await expect(storage.get("s3://global/object")).rejects.toMatchObject({
      name: "ObjectNotFoundError",
    });

    expect(azure.driverCalls).toBe(1);
    expect(resolver.hosts).toEqual(["minio.example.test"]);
    await aws.close();
  });

  it("rejects an Azure write selection without its explicit driver factory", () => {
    expect(() =>
      WorkerStoredObjectStorageRuntimeFactory.create({
        config: { backend: "azure", localFilesystemRoot: "/objects" },
        projects: new ProjectSource(null),
      }),
    ).toThrow("Azure driver factory");
  });
});
