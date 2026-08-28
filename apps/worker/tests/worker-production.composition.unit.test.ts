import {
  InMemoryProcessStore,
  type EventSourcedQueueProcessor,
  type EventSourcing,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { ResourceScope } from "@langwatch/runtime-composition";
import { TraceTopicAssignmentPort, type AssignTopicCommandData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { WorkerProductionComposition } from "../src/app/worker-production.composition";
import { resolveWorkerConfig } from "../src/platform/config/worker.config";
import {
  TopicWorkerFeatureInstaller,
  type TopicWorkerCapability,
} from "../src/features/topic/topic-worker-feature.installer";
import { TraceWorkerFeatureInstaller } from "../src/features/trace/trace-worker-feature.installer";
import { WorkerEventingRuntime } from "../src/platform/eventing/worker-eventing.runtime";
import {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../src/platform/lifecycle/worker-runtime.port";

class Queue implements EventSourcedQueueProcessor<Record<string, unknown>> {
  readonly send = vi.fn(async () => undefined);
  readonly sendBatch = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly waitUntilReady = vi.fn(async () => undefined);
}

class Handle extends WorkerHandlePort {
  readonly shutdown = vi.fn(async () => undefined);
}

class Transport extends WorkerTransportPort {
  readonly handle = new Handle();
  readonly start = vi.fn(async () => this.handle);
}

class Lifecycle extends WorkerLifecyclePort {
  readonly close = vi.fn(async () => undefined);
}

class TopicCapability implements TopicWorkerCapability {
  readonly install = vi.fn();
  readonly startBootSeeds = vi.fn();
  readonly commandDispatch = {
    recordTopics: vi.fn(async () => undefined),
    requestClustering: vi.fn(async () => undefined),
  };
}

class EventingTopicCapability implements TopicWorkerCapability {
  readonly install = vi.fn();
  readonly startBootSeeds = vi.fn();
  readonly commandDispatch: TopicWorkerCapability["commandDispatch"];

  constructor(readonly commandSend = vi.fn(async () => undefined)) {
    this.commandDispatch = {
      recordTopics: async () => undefined,
      requestClustering: commandSend,
    };
  }
}

class TraceAssignments extends TraceTopicAssignmentPort {
  readonly assignTopic = vi.fn(async (_input: AssignTopicCommandData) => undefined);
}

class TraceInstaller {
  readonly install = vi.fn((_eventSourcing: EventSourcing) => ({
    traceAssignments: this.traceAssignments,
  }));

  constructor(private readonly traceAssignments: TraceTopicAssignmentPort) {}
}

class Projects {
  async tryGetOrganizationId(projectId: string): Promise<string | null> {
    return projectId === "project-1" ? "org-1" : null;
  }
}

class Configuration {
  tryForOrganization(organizationId: string) {
    if (organizationId !== "org-1") return null;
    return {
      proxyRoleArn: "proxy-role",
      bedrockRoleArn: "bedrock-role",
      proxyAwsAccessKeyId: "proxy-key",
      proxyAwsSecretAccessKey: "proxy-secret",
      bedrockProxyEndpoint: "bedrock.example.com",
      region: "us-east-1",
    };
  }
}

class Credentials {
  async assumeCustomerRole() {
    return {
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      sessionToken: "session-token",
    };
  }
}

describe("WorkerProductionComposition", () => {
  it("installs Topic's producer graph and boot seeds without claiming the shared Eventing queue", async () => {
    const queue = new Queue();
    const eventing = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumersEnabled: false,
    });
    const capability = new TopicCapability();
    const topic = TopicWorkerFeatureInstaller.create({
      installer: capability,
      eventing,
      traceAssignments: { assignTopic: async () => undefined },
    });
    const transport = new Transport();
    const lifecycle = new Lifecycle();
    const composition = WorkerProductionComposition.createFromPorts({
      config: resolveWorkerConfig({ NODE_ENV: "test" }),
      eventing,
      lifecycle,
      transport,
      topic,
      enterprise: {
        managedProvider: {
          projects: new Projects(),
          configuration: new Configuration(),
          credentials: new Credentials(),
        },
      },
    });

    await composition.application.start();

    expect(capability.install).toHaveBeenCalledWith({
      eventSourcing: eventing.eventSourcing,
      traceAssignments: expect.any(Object),
    });
    expect(capability.startBootSeeds).toHaveBeenCalledOnce();
    expect(queue.waitUntilReady).toHaveBeenCalledOnce();
    expect(transport.start).toHaveBeenCalledOnce();

    await composition.topic.requestManualRun("project-1", 123);

    expect(capability.commandDispatch.requestClustering).toHaveBeenCalledWith({
      tenantId: "project-1",
      occurredAt: 123,
      trigger: "manual",
    });
    await expect(
      composition.enterprise?.managedProviders?.buildLitellmParameters({
        params: { api_key: "customer-key" },
        projectId: "project-1",
        model: "anthropic.claude-3-sonnet",
        modelProvider: { provider: "bedrock" },
      }),
    ).resolves.toMatchObject({
      aws_access_key_id: "access-key",
      aws_bedrock_runtime_endpoint: "http://bedrock.example.com",
    });

    await composition.application.close();

    expect(transport.handle.shutdown).toHaveBeenCalledOnce();
    expect(lifecycle.close).toHaveBeenCalledOnce();
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("installs Trace before Topic and passes Topic Trace's canonical assignment port", async () => {
    const queue = new Queue();
    const eventing = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumersEnabled: false,
    });
    const traceAssignments = new TraceAssignments();
    const traceInstaller = new TraceInstaller(traceAssignments);
    const trace = TraceWorkerFeatureInstaller.create({
      installer: traceInstaller,
      eventing,
    });
    const capability = new TopicCapability();
    const topic = TopicWorkerFeatureInstaller.create({
      installer: capability,
      eventing,
      traceAssignments: trace.traceAssignments,
    });
    const composition = WorkerProductionComposition.createFromPorts({
      config: resolveWorkerConfig({ NODE_ENV: "test" }),
      eventing,
      lifecycle: new Lifecycle(),
      transport: new Transport(),
      trace,
      topic,
    });

    await composition.application.start();

    expect(traceInstaller.install).toHaveBeenCalledWith(eventing.eventSourcing);
    expect(capability.install).toHaveBeenCalledWith({
      eventSourcing: eventing.eventSourcing,
      traceAssignments: trace.traceAssignments,
    });
    expect(traceInstaller.install.mock.invocationCallOrder[0]).toBeLessThan(
      capability.install.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("routes manual Topic dispatch through the Eventing command sender", async () => {
    const queue = new Queue();
    const eventing = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumersEnabled: false,
    });
    const capability = new EventingTopicCapability();
    const topic = TopicWorkerFeatureInstaller.create({
      installer: capability,
      eventing,
      traceAssignments: { assignTopic: async () => undefined },
    });
    const composition = WorkerProductionComposition.createFromPorts({
      config: resolveWorkerConfig({ NODE_ENV: "test" }),
      eventing,
      lifecycle: new Lifecycle(),
      transport: new Transport(),
      topic,
    });

    await composition.application.start();
    await composition.topic.requestManualRun("project-1", 456);

    expect(capability.commandSend).toHaveBeenCalledWith({
      tenantId: "project-1",
      occurredAt: 456,
      trigger: "manual",
    });

    await composition.application.close();
  });

  it("does not close a parent resource scope from the production composition", async () => {
    const queue = new Queue();
    const eventing = WorkerEventingRuntime.create({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory: () => queue,
      processStore: InMemoryProcessStore.createForTesting(),
      executionTarget: "worker",
      warnWhenProjectionsRunInline: false,
      consumersEnabled: false,
    });
    const resources = new ResourceScope();
    const closeResource = vi.fn();
    resources.own("parent", closeResource);
    const capability = new TopicCapability();
    const topic = TopicWorkerFeatureInstaller.create({
      installer: capability,
      eventing,
      traceAssignments: { assignTopic: async () => undefined },
    });
    const composition = WorkerProductionComposition.createFromPorts({
      config: resolveWorkerConfig({ NODE_ENV: "test" }),
      eventing,
      lifecycle: new Lifecycle(),
      transport: new Transport(),
      topic,
      resources,
    });

    await composition.application.start();
    await composition.application.close();

    expect(closeResource).not.toHaveBeenCalled();
    await resources.close();
    expect(closeResource).toHaveBeenCalledOnce();
  });
});
