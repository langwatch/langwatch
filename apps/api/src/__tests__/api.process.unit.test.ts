import { AgentService } from "@langwatch/agent-contract";
import { SecretService } from "@langwatch/secret-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listenerStart = vi.fn(async () => ({ host: "127.0.0.1", port: 5560 }));
  const listenerClose = vi.fn(async () => undefined);
  const observabilityShutdown = vi.fn(async () => undefined);
  const listener = { start: listenerStart, close: listenerClose };

  return {
    listenerStart,
    listenerClose,
    observabilityShutdown,
    listener,
    createListener: vi.fn(() => listener),
    createObservability: vi.fn(() => ({
      logger: { info: vi.fn(), error: vi.fn() },
      tracer: {},
      shutdown: observabilityShutdown,
    })),
  };
});

vi.mock("@langwatch/observability/node", () => ({
  createProcessObservability: mocks.createObservability,
}));

vi.mock("../api-http.listener", () => ({
  ApiHttpListener: { create: mocks.createListener },
}));

import { ApiProcess } from "../api.process";
import { ApiFeatureDrainPort, ApiProcessGraphPort } from "../api.process";
import { ApiReadinessPort } from "../api-process.lifecycle";

class TestAgentService extends AgentService {
  getById() {
    return this.unavailable();
  }

  getAll() {
    return this.unavailable();
  }

  getReferenceStates() {
    return this.unavailable();
  }

  getNamesByIds() {
    return this.unavailable();
  }

  exists() {
    return this.unavailable();
  }

  list() {
    return this.unavailable();
  }

  create() {
    return this.unavailable();
  }

  update() {
    return this.unavailable();
  }

  archive() {
    return this.unavailable();
  }

  relatedEntities() {
    return this.unavailable();
  }

  cascadeArchive() {
    return this.unavailable();
  }

  getCopies() {
    return this.unavailable();
  }

  getSourceOfCopy() {
    return this.unavailable();
  }

  copy() {
    return this.unavailable();
  }

  pushToCopies() {
    return this.unavailable();
  }

  syncFromSource() {
    return this.unavailable();
  }

  getHistory() {
    return this.unavailable();
  }

  private unavailable(): never {
    throw new Error("Not used by this test.");
  }
}

class TestSecretService extends SecretService {
  async list() {
    return [];
  }

  async getValues() {
    return {};
  }

  get() {
    return this.unavailable();
  }

  create() {
    return this.unavailable();
  }

  update() {
    return this.unavailable();
  }

  async delete() {}

  private unavailable(): never {
    throw new Error("Not used by this test.");
  }
}

describe("ApiProcess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listenerStart.mockResolvedValue({ host: "127.0.0.1", port: 5560 });
    mocks.listenerClose.mockResolvedValue(undefined);
    mocks.observabilityShutdown.mockResolvedValue(undefined);
  });

  it("always shuts down observability after an intake close failure and retains that failure", async () => {
    const phases: string[] = [];
    const intakeFailure = new Error("listener close failed");
    mocks.listenerClose.mockImplementation(async () => {
      phases.push("listener");
      throw intakeFailure;
    });
    mocks.observabilityShutdown.mockImplementation(async () => {
      phases.push("observability");
      throw new Error("observability shutdown failed");
    });
    const process = createProcess();

    await expect(Promise.all([process.close(), process.close()])).rejects.toBe(intakeFailure);

    expect(phases).toEqual(["listener", "observability"]);
    expect(mocks.listenerClose).toHaveBeenCalledOnce();
    expect(mocks.observabilityShutdown).toHaveBeenCalledOnce();
  });

  it("drains HTTP and features before telemetry and composed resources", async () => {
    const phases: string[] = [];
    mocks.listenerClose.mockImplementation(async () => {
      phases.push("listener");
    });
    mocks.observabilityShutdown.mockImplementation(async () => {
      phases.push("telemetry");
    });
    const graph = new TestGraph(async () => {
      phases.push("graph");
    });
    graph.drain.mockImplementationOnce(async () => {
      phases.push("graph-drain");
    });
    const featureDrain = new TestFeatureDrain(async () => {
      phases.push("feature-drain");
    });
    const process = createProcess(graph, undefined, featureDrain);

    await Promise.all([process.close(), process.close()]);

    expect(phases).toEqual(["listener", "feature-drain", "graph-drain", "telemetry", "graph"]);
    expect(graph.close).toHaveBeenCalledOnce();
  });

  it("continues every cleanup phase and retains the first shutdown failure", async () => {
    const phases: string[] = [];
    const listenerFailure = new Error("listener close failed");
    mocks.listenerClose.mockImplementation(async () => {
      phases.push("listener");
      throw listenerFailure;
    });
    const graph = new TestGraph(async () => {
      phases.push("graph");
      throw new Error("graph close failed");
    });
    graph.drain.mockImplementationOnce(async () => {
      phases.push("graph-drain");
      throw new Error("graph drain failed");
    });
    const featureDrain = new TestFeatureDrain(async () => {
      phases.push("feature-drain");
      throw new Error("feature drain failed");
    });
    mocks.observabilityShutdown.mockImplementation(async () => {
      phases.push("telemetry");
      throw new Error("telemetry shutdown failed");
    });
    const process = createProcess(graph, undefined, featureDrain);

    await expect(process.close()).rejects.toBe(listenerFailure);

    expect(phases).toEqual(["listener", "feature-drain", "graph-drain", "telemetry", "graph"]);
  });

  it("runs the boot readiness gate before opening HTTP intake", async () => {
    const readiness = new TestReadiness();
    const process = createProcess(undefined, readiness);

    await process.start();

    expect(readiness.assertReady).toHaveBeenCalledOnce();
    expect(mocks.listenerStart).toHaveBeenCalledOnce();
  });

  it("does not open HTTP intake when boot readiness fails", async () => {
    const readiness = new TestReadiness();
    readiness.assertReady.mockRejectedValueOnce(new Error("redis unavailable"));
    const process = createProcess(undefined, readiness);

    await expect(process.start()).rejects.toThrow("redis unavailable");

    expect(mocks.listenerStart).not.toHaveBeenCalled();
  });
});

class TestReadiness extends ApiReadinessPort {
  readonly assertReady = vi.fn(async () => undefined);
}

class TestGraph extends ApiProcessGraphPort {
  private readonly closeImpl: () => Promise<void>;

  constructor(closeImpl: () => Promise<void>) {
    super();
    this.closeImpl = closeImpl;
  }

  readonly close = vi.fn(async () => this.closeImpl());

  readonly drain = vi.fn(async () => undefined);
}

class TestFeatureDrain extends ApiFeatureDrainPort {
  private readonly drainImpl: () => Promise<void>;

  constructor(drainImpl: () => Promise<void>) {
    super();
    this.drainImpl = drainImpl;
  }

  readonly drain = vi.fn(async () => this.drainImpl());
}

function createProcess(
  graph?: ApiProcessGraphPort,
  readiness?: ApiReadinessPort,
  featureDrain?: ApiFeatureDrainPort,
): ApiProcess {
  return ApiProcess.create({
    agents: new TestAgentService(),
    secrets: new TestSecretService(),
    http: {
      createContext: async () => ({
        actor: () => ({ id: "user-1" }),
        authorize: async () => undefined,
      }),
    },
    observability: { serviceName: "langwatch:api-test" },
    listener: { port: 0 },
    graph,
    readiness,
    featureDrain,
  });
}
