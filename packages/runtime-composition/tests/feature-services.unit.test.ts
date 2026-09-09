import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/application.ts";
import { moduleApi } from "../src/module-api-token.ts";
import { defineModule, type FeatureSetup } from "../src/feature-installer.ts";
import { ResourceScope, type ResourceOwnership } from "../src/resource-scope.ts";

interface ProjectApi {
  name(): string;
}
const ProjectApi = moduleApi<ProjectApi>("project");

interface Infrastructure {
  events: string[];
  bootFailure?: Error;
  startFailure?: Error;
  stopFailure?: Error;
  starting?: () => Promise<void>;
  capture?: (resources: ResourceOwnership) => void;
}

class ProjectApp implements ProjectApi {
  static readonly contract = ProjectApi;
  static readonly dependencies = {};

  private constructor() {}

  static create({
    infrastructure,
    resources,
  }: FeatureSetup<typeof ProjectApp.dependencies, Infrastructure, undefined>): ProjectApi {
    const { events } = infrastructure;
    resources.own("connection", () => {
      events.push("connection:close");
    });
    resources.ownService({
      name: "subscription",
      start: async () => {
        events.push("subscription:start");
        await infrastructure.starting?.();
        if (infrastructure.startFailure) throw infrastructure.startFailure;
      },
      stop: () => {
        events.push("subscription:stop");
        if (infrastructure.stopFailure) throw infrastructure.stopFailure;
      },
    });
    resources.ownService({
      name: "followup",
      start: () => {
        events.push("followup:start");
      },
      stop: () => {
        events.push("followup:stop");
      },
    });
    infrastructure.capture?.(resources);
    if (infrastructure.bootFailure) throw infrastructure.bootFailure;

    return new ProjectApp();
  }

  name(): string {
    return "project";
  }
}

const project = defineModule("project").withApp(ProjectApp).build();
function graph(infrastructure: Infrastructure) {
  return createApp({ name: "lifecycle" }).withInfrastructure(infrastructure).withModule(project);
}

describe("feature-owned runtime services", () => {
  it.each(["api", "worker"] as const)(
    "starts after boot and drains hosts before feature services in %s",
    async (role) => {
      const events: string[] = [];
      let callApi = () => "not installed";
      const runtime = await graph({ events })
        .withService({
          name: "host",
          start: () => {
            events.push(`host:start:${callApi()}`);
          },
          stop: () => {
            events.push(`host:stop:${callApi()}`);
          },
        })
        .boot({ role });
      callApi = () => runtime.module(project).provided.name();

      expect(events).toEqual([]);
      await Promise.all([runtime.start(), runtime.start()]);
      expect(events).toEqual(["subscription:start", "followup:start", "host:start:project"]);

      await Promise.all([runtime.stop(), runtime.stop()]);
      expect(events).toEqual([
        "subscription:start",
        "followup:start",
        "host:start:project",
        "host:stop:project",
        "followup:stop",
        "subscription:stop",
        "connection:close",
      ]);
      expect(callApi).toThrow("closed");
    },
  );

  it("releases construction allocations on boot failure without starting or stopping inert services", async () => {
    const events: string[] = [];
    const failure = new Error("factory failed");

    await expect(graph({ events, bootFailure: failure }).boot({ role: "api" })).rejects.toBe(
      failure,
    );
    expect(events).toEqual(["connection:close"]);
  });

  it("stops only the attempted feature service when its start fails", async () => {
    const events: string[] = [];
    const failure = new Error("subscription failed");
    const hostStart = vi.fn<() => void>();
    const hostStop = vi.fn<() => void>();
    const runtime = await graph({ events, startFailure: failure })
      .withService({ name: "host", start: hostStart, stop: hostStop })
      .boot({ role: "api" });

    await expect(runtime.start()).rejects.toBe(failure);
    await runtime.stop();
    expect(events).toEqual(["subscription:start", "subscription:stop", "connection:close"]);
    expect(hostStart).not.toHaveBeenCalled();
    expect(hostStop).not.toHaveBeenCalled();
  });

  it("rolls back a failed host before stopping feature services", async () => {
    const events: string[] = [];
    const failure = new Error("listen failed");
    const runtime = await graph({ events })
      .withService({
        name: "host",
        start: () => {
          throw failure;
        },
        stop: () => {
          events.push("host:stop");
        },
      })
      .boot({ role: "api" });

    await expect(runtime.start()).rejects.toBe(failure);
    expect(events).toEqual([
      "subscription:start",
      "followup:start",
      "host:stop",
      "followup:stop",
      "subscription:stop",
      "connection:close",
    ]);
  });

  it("closes allocations without stopping inert services when stopped before start", async () => {
    const events: string[] = [];
    const runtime = await graph({ events }).boot({ role: "api" });

    await runtime.stop();
    await expect(runtime.start()).rejects.toThrow("stopped runtime");
    expect(events).toEqual(["connection:close"]);
  });

  it("drains a concurrent start before stopping its services", async () => {
    const events: string[] = [];
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = await graph({ events, starting: () => waiting }).boot({ role: "api" });
    const starting = runtime.start();
    const stopping = runtime.stop();
    await Promise.resolve();
    expect(events).toEqual(["subscription:start"]);

    release();
    await Promise.all([starting, stopping]);
    expect(events).toEqual([
      "subscription:start",
      "followup:start",
      "followup:stop",
      "subscription:stop",
      "connection:close",
    ]);
  });

  it("still closes allocations if a service stop throws and never retries that stop", async () => {
    const events: string[] = [];
    const runtime = await graph({ events, stopFailure: new Error("unsubscribe failed") }).boot({
      role: "api",
    });
    await runtime.start();
    const stopping = runtime.stop();

    await expect(stopping).rejects.toThrow("started services");
    expect(runtime.stop()).toBe(stopping);
    expect(events).toEqual([
      "subscription:start",
      "followup:start",
      "followup:stop",
      "subscription:stop",
      "connection:close",
    ]);
  });

  it("seals service registration after install while allowing startup allocation ownership", async () => {
    let ownership: ResourceOwnership = new ResourceScope();
    const closeLateAllocation = vi.fn<() => void>();
    const runtime = await graph({
      events: [],
      capture: (resources) => {
        ownership = resources;
      },
    }).boot({ role: "api" });

    expect(() =>
      ownership.ownService({
        name: "too late",
        start: vi.fn<() => void>(),
        stop: vi.fn<() => void>(),
      }),
    ).toThrow("registration is closed");
    ownership.own("allocated during startup", closeLateAllocation);
    await runtime.stop();
    expect(closeLateAllocation).toHaveBeenCalledOnce();
  });
});
