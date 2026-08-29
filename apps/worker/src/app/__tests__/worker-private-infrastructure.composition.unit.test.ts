import { AwsClientProcessRuntime, OutboundProxyResolverPort } from "@langwatch/aws-client";
import { describe, expect, it } from "vitest";
import { createWorkerPrivateInfrastructureComposition } from "../worker-private-infrastructure.composition";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import {
  WorkerAzureStorageFactoryPort,
  WorkerProjectS3SourcePort,
} from "../../platform/infrastructure/worker-stored-object-storage.adapter";

class Projects extends WorkerProjectS3SourcePort {
  async tryGet(projectId: string) {
    return projectId === "byoc-project" ? { bucket: "byoc-bucket" } : null;
  }
}

class Azure extends WorkerAzureStorageFactoryPort {
  createDriver() {
    return undefined;
  }

  override resolve() {
    return { accountName: "worker-account", container: "worker-container" };
  }
}

class NoProxy extends OutboundProxyResolverPort {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

describe("createWorkerPrivateInfrastructureComposition", () => {
  it("maps one typed Worker boot projection without activating consumers", async () => {
    const config = resolveWorkerConfig({
      REDIS_URL: "redis://redis.example.test:6379",
      GLOBAL_QUEUE_CONCURRENCY: "4",
      S3_BUCKET_NAME: "global-bucket",
      S3_ACCESS_KEY_ID: "access-key",
      S3_SECRET_ACCESS_KEY: "secret-key",
      HTTPS_PROXY: "https://proxy.example.test",
      NO_PROXY: ".internal.example.test",
    });

    const infrastructure = createWorkerPrivateInfrastructureComposition({
      config,
      ports: { projects: new Projects() },
    });

    expect(infrastructure.redis).toEqual(config.infrastructure.redis);
    expect(infrastructure.queuePolicy).toEqual(config.infrastructure.groupQueue);
    expect(infrastructure.outboundProxy.tryResolveForHost("api.example.test")).toBe(
      "https://proxy.example.test",
    );
    expect(infrastructure.outboundProxy.tryResolveForHost("api.internal.example.test")).toBe(
      undefined,
    );

    const runtime = infrastructure.storedObjectStorage!.createRuntime();
    const aws = AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() });
    try {
      await expect(runtime.forProject("byoc-project", aws).resolveDestination()).resolves.toEqual({
        kind: "s3",
        bucket: "byoc-bucket",
      });
      await expect(runtime.forProject("global-project", aws).resolveDestination()).resolves.toEqual(
        {
          kind: "s3",
          bucket: "global-bucket",
        },
      );
    } finally {
      await aws.close();
    }
  });

  it("requires an explicit Azure factory only when the Worker selects Azure", () => {
    const config = resolveWorkerConfig({ STORED_OBJECTS_BACKEND: "azure" });

    expect(() =>
      createWorkerPrivateInfrastructureComposition({
        config,
        ports: { projects: new Projects() },
      }),
    ).toThrow("Worker Azure storage requires a configured Azure driver factory");
  });

  it("uses the injected Azure capability without reading the legacy application", async () => {
    const infrastructure = createWorkerPrivateInfrastructureComposition({
      config: resolveWorkerConfig({ STORED_OBJECTS_BACKEND: "azure" }),
      ports: { projects: new Projects(), azure: new Azure() },
    });

    const runtime = infrastructure.storedObjectStorage!.createRuntime();
    const aws = AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() });
    try {
      await expect(runtime.forProject("global-project", aws).resolveDestination()).resolves.toEqual(
        {
          kind: "azure",
          accountName: "worker-account",
          container: "worker-container",
        },
      );
    } finally {
      await aws.close();
    }
  });
});
