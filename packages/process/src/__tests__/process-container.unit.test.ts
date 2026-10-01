import { describe, expect, it } from "vitest";

import { bootInstalledProcess } from "../boot-installed-process.ts";
import { serverFeature } from "../feature-installer.ts";
import {
  ApiProcessContainer,
  WorkerProcessContainer,
  type ProcessBoot,
} from "../process-container.ts";

function containerRuntime(phases: string[]): ProcessBoot {
  return {
    surfaceDefaults: {},
    async boot({ role, modules, pipelines }) {
      const eventing = pipelines.configure({ defaultRetentionDays: 30 });
      phases.push(eventing.consumersEnabled ? "consumer" : "producer");
      return bootInstalledProcess({
        role,
        modules,
        config: {},
        members: {
          order: [],
          read(name) {
            throw new Error(`Unexpected member: ${name}`);
          },
          async close() {},
        },
        surface: () => ({ hosts: {}, serve: () => "bundle handler" }),
      });
    },
  };
}

describe("process container", () => {
  /** @scenario "A bundle-only API builds a handler without running worker contributions" */
  it("boots a bundle-only API without constructing worker contributions", async () => {
    const phases: string[] = [];
    const module = serverFeature("jobs")
      .withSetup(() => ({}))
      .withWorker(() => {
        phases.push("worker");
        return {};
      })
      .build();
    const runtime = await new ApiProcessContainer(containerRuntime(phases), [module])
      .exposeTransports((transports) => transports.browserBundle())
      .boot();
    expect(runtime.handler).toBe("bundle handler");
    expect(phases).toEqual(["producer"]);
    await runtime.stop();
  });

  /** @scenario "Worker services start after boot and drain before their module closes" */
  it("starts worker services after boot and drains them before closing their module", async () => {
    const phases: string[] = [];
    const module = serverFeature("jobs")
      .withSetup(({ resources }) => {
        resources.ownService({
          name: "jobs",
          start() {
            phases.push("start");
          },
          stop() {
            phases.push("drain");
          },
        });
        return {};
      })
      .withClose(() => {
        phases.push("close");
      })
      .build();
    const worker = new WorkerProcessContainer(containerRuntime(phases), [module]);
    const runtime = await worker.boot();
    expect(phases).toEqual(["consumer"]);
    expect("exposeTransports" in worker).toBe(false);
    await runtime.start();
    await runtime.stop();
    expect(phases).toEqual(["consumer", "start", "drain", "close"]);
  });
});
