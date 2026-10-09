// @vitest-environment node
import { mkdtemp, readFile } from "fs/promises";
import http from "http";
import net from "net";
import os from "os";
import path from "path";
import { setTimeout as delay } from "timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  freeLoopbackPort,
  idleBoundMs,
  isListening,
  startDormantTool,
  type DormantTool,
} from "../dormant-dev-tool";

// The stand-in tool: a shell wrapper with a backgrounded child (like pnpm's), exec'ing a
// tiny server.
const SERVER = `require("http").createServer((q, s) => s.end("tool")).listen(+process.argv[1], "127.0.0.1")`;

const tools: DormantTool[] = [];

afterEach(() => {
  for (const tool of tools.splice(0)) tool.close();
});

async function fakeTool({ idleAfterMs }: { idleAfterMs: number }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dormant-tool-"));
  const pidFile = path.join(dir, "wrapper-child.pid");
  const port = await freeLoopbackPort();
  const starts: number[] = [];
  const tool = startDormantTool({
    name: "fake",
    port,
    cwd: dir,
    idleAfterMs,
    log: () => undefined,
    command: ({ port: inner }) => {
      starts.push(inner);
      return {
        file: "sh",
        args: [
          "-c",
          `sleep 300 & echo $! > "${pidFile}"; exec "${process.execPath}" -e '${SERVER}' ${inner}`,
        ],
      };
    },
  });
  tools.push(tool);
  await eventually({ check: () => isListening({ port }) });
  return { tool, url: `http://127.0.0.1:${port}/`, starts, pidFile };
}

async function eventually({ check }: { check: () => boolean | Promise<boolean> }): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition never held");
    await delay(25);
  }
}

function isAlive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("dormant developer tool", () => {
  /** @scenario "A developer tool stays dormant until someone visits it" */
  it("runs nothing until the first visit, then serves the page from the tool", async () => {
    const { tool, url, starts } = await fakeTool({ idleAfterMs: 0 });

    expect((await fetch(url, { method: "HEAD" })).status).toBe(200);
    expect(tool.state()).toBe("dormant");
    expect(starts).toHaveLength(0);

    expect(await (await fetch(url)).text()).toBe("tool");
    expect(tool.state()).toBe("ready");
    expect(starts).toHaveLength(1);
  }, 15_000);

  /** @scenario "A health probe does not wake a dormant developer tool" */
  it("answers HEAD, OPTIONS, a Go health check and Vite's ping without starting the tool", async () => {
    const { tool, url, starts } = await fakeTool({ idleAfterMs: 0 });
    const probes: { init: RequestInit; status: number }[] = [
      { init: { method: "HEAD" }, status: 200 },
      { init: { method: "OPTIONS" }, status: 200 },
      { init: { headers: { "user-agent": "Go-http-client/1.1" } }, status: 200 },
      { init: { headers: { accept: "text/x-vite-ping" } }, status: 503 },
    ];

    for (const probe of probes) {
      expect((await fetch(url, probe.init)).status).toBe(probe.status);
    }
    expect(tool.state()).toBe("dormant");
    expect(starts).toHaveLength(0);
  }, 15_000);

  /** @scenario "Concurrent first visits start one developer tool" */
  it("starts the tool once for several simultaneous first visits", async () => {
    const { url, starts } = await fakeTool({ idleAfterMs: 0 });

    const pages = await Promise.all(
      Array.from({ length: 5 }, () => fetch(url).then((answer) => answer.text())),
    );

    expect(pages).toEqual(["tool", "tool", "tool", "tool", "tool"]);
    expect(starts).toHaveLength(1);
  }, 15_000);

  /** @scenario "An idle developer tool is shut down with its whole process chain" */
  it("stops the whole process group once idle and starts again on the next visit", async () => {
    const { tool, url, starts, pidFile } = await fakeTool({ idleAfterMs: 200 });
    await (await fetch(url)).text();
    const wrapperChild = Number(await readFile(pidFile, "utf8"));
    expect(isAlive({ pid: wrapperChild })).toBe(true);

    await eventually({ check: () => tool.state() === "dormant" });
    await eventually({ check: () => !isAlive({ pid: wrapperChild }) });

    expect(await (await fetch(url)).text()).toBe("tool");
    expect(starts).toHaveLength(2);
  }, 20_000);

  /** @scenario "A stopped developer tool revives for a tab left open" */
  it("wakes the tool on a refused websocket upgrade so the tab's retry succeeds", async () => {
    const { tool, url, starts } = await fakeTool({ idleAfterMs: 0 });

    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(url, { headers: { connection: "Upgrade", upgrade: "websocket" } });
      req.on("response", (answer) => resolve(answer.statusCode ?? 0));
      req.on("error", reject);
      req.end();
    });

    expect(status).toBe(503);
    await eventually({ check: () => tool.state() === "ready" });
    expect(starts).toHaveLength(1);
  }, 15_000);

  /** @scenario "A restarted dev server takes its developer tool port back" */
  it("retries the bind until a restarting dev server releases the port", async () => {
    const port = await freeLoopbackPort();
    const holder = net.createServer().listen(port, "127.0.0.1");
    await new Promise((resolve) => holder.once("listening", resolve));
    const tool = startDormantTool({
      name: "fake",
      port,
      cwd: os.tmpdir(),
      idleAfterMs: 0,
      log: () => undefined,
      command: () => ({ file: "true", args: [] }),
    });
    tools.push(tool);
    await delay(400);
    holder.close();

    await eventually({
      check: async () =>
        (await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" }).catch(() => undefined))
          ?.status === 200,
    });

    expect(tool.state()).toBe("dormant");
  }, 15_000);

  describe("when the developer pins the tools open", () => {
    /** @scenario "A pinned developer tool stays running when idle" */
    it("reads off and 0 as pinned, and a duration as the bound", () => {
      expect(idleBoundMs({ value: "off" })).toBe(0);
      expect(idleBoundMs({ value: "0" })).toBe(0);
      expect(idleBoundMs({ value: undefined })).toBe(30 * 60_000);
      expect(idleBoundMs({ value: "90s" })).toBe(90_000);
      expect(idleBoundMs({ value: "45m" })).toBe(45 * 60_000);
      expect(idleBoundMs({ value: "2h" })).toBe(2 * 3_600_000);
      expect(idleBoundMs({ value: "soon" })).toBe(30 * 60_000);
    });

    /** @scenario "A pinned developer tool stays running when idle" */
    it("keeps a visited tool running however long it sits idle", async () => {
      const { tool, url } = await fakeTool({ idleAfterMs: 0 });
      await (await fetch(url)).text();

      await delay(400);

      expect(tool.state()).toBe("ready");
    }, 15_000);
  });
});
