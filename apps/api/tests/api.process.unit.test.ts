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

vi.mock("../src/api-http.listener", () => ({
  ApiHttpListener: { create: mocks.createListener },
}));

import { ApiProcess } from "../src/api.process";
import { ApiProcessGraphPort } from "../src/api.process";

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

  it("closes listener, composed graph, then telemetry in that order", async () => {
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
    const process = createProcess(graph);

    await Promise.all([process.close(), process.close()]);

    expect(phases).toEqual(["listener", "graph", "telemetry"]);
    expect(graph.close).toHaveBeenCalledOnce();
  });
});

class TestGraph extends ApiProcessGraphPort {
  private readonly closeImpl: () => Promise<void>;

  constructor(closeImpl: () => Promise<void>) {
    super();
    this.closeImpl = closeImpl;
  }

  readonly close = vi.fn(async () => this.closeImpl());
}

function createProcess(graph?: ApiProcessGraphPort): ApiProcess {
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
  });
}
