import net from "node:net";

import { Task } from "@langwatch/task";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runModuleTask } from "../module-task.ts";

const ports = vi.hoisted(() => ({ environment: {} as Record<string, string> }));

vi.mock("../process-modules.generated.ts", () => ({ processModules: [] }));
vi.mock("../config.ts", () => ({ processEnvironment: ports.environment }));

const listen = (port: number): Promise<net.Server> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });

const close = (server: net.Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

const freePort = async (): Promise<number> => {
  const probe = await listen(0);
  const { port } = probe.address() as net.AddressInfo;
  await close(probe);
  return port;
};

/** Runs inside the task: the serving ports are free to bind while the task holds the process. */
class PortProbeTask extends Task {
  readonly name = "probe-ports";
  readonly description = "binds the serving ports to prove the task process left them free";
  readonly bound: number[] = [];

  constructor(private readonly servingPorts: readonly number[]) {
    super();
  }

  async run(): Promise<void> {
    for (const port of this.servingPorts) {
      await close(await listen(port));
      this.bound.push(port);
    }
  }
}

const held: net.Server[] = [];

afterEach(async () => {
  await Promise.all(held.splice(0).map(close));
  for (const key of Object.keys(ports.environment)) delete ports.environment[key];
});

const runProbe = async (task: Task): Promise<void> =>
  runModuleTask({
    name: task.name,
    args: [],
    signal: new AbortController().signal,
    plugins: { taskModules: "@test/probe", importModule: async () => ({ tasks: [task] }) },
  });

describe("given a module task run beside the serving processes", () => {
  describe("when API_PORT and WORKER_METRICS_PORT are free", () => {
    /** @scenario "A module task binds no port the serving processes use" */
    it("leaves both serving ports unbound while the task runs", async () => {
      const apiPort = await freePort();
      const workerPort = await freePort();
      Object.assign(ports.environment, {
        API_PORT: String(apiPort),
        WORKER_METRICS_PORT: String(workerPort),
      });
      const task = new PortProbeTask([apiPort, workerPort]);

      await runProbe(task);

      expect(task.bound).toEqual([apiPort, workerPort]);
    });
  });

  describe("when the api already holds API_PORT", () => {
    /** @scenario "A module task still runs while the api holds API_PORT" */
    it("runs its task to completion instead of failing with EADDRINUSE", async () => {
      const api = await listen(0);
      held.push(api);
      const apiPort = (api.address() as net.AddressInfo).port;
      Object.assign(ports.environment, { API_PORT: String(apiPort) });
      const task = new PortProbeTask([]);
      const ran = vi.spyOn(task, "run");

      await runProbe(task);

      expect(ran).toHaveBeenCalledTimes(1);
    });
  });
});
