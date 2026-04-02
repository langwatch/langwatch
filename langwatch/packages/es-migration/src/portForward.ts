import { spawn, type ChildProcess } from "node:child_process";
import { connect, type Socket } from "node:net";
import type { Logger } from "./lib/types.js";

const RESPAWN_DELAY_MS = 1_000;
const PROBE_INTERVAL_MS = 200;
const PROBE_TIMEOUT_MS = 30_000;

export class PortForward {
  private child: ChildProcess | null = null;
  private stopped = false;
  private portInUseDeath = false;

  constructor(
    private readonly opts: {
      service: string;
      localPort: number;
      remotePort: number;
      namespace?: string;
      logger: Logger;
    },
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.spawn();
    await this.waitForReady();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.child) {
      this.child.removeAllListeners();
      this.child.kill();
      this.child = null;
    }
  }

  private spawn(): void {
    const { service, localPort, remotePort, namespace, logger } = this.opts;

    const args = ["port-forward", service, `${localPort}:${remotePort}`];
    if (namespace) {
      args.push("-n", namespace);
    }

    logger.info("Starting kubectl port-forward", {
      service,
      localPort,
      remotePort,
      namespace,
    });

    const child = spawn("kubectl", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (data: Buffer) => {
      logger.info("port-forward stdout", { output: data.toString().trim() });
    });

    child.stderr?.on("data", (data: Buffer) => {
      const output = data.toString().trim();
      if (!output) return;

      // kubectl port-forward emits noisy Go HTTP/2 transport frames at verbose
      // log levels — suppress them entirely so migration progress stays readable.
      if (isKubectlTransportNoise(output)) return;

      if (output.includes("address already in use")) {
        this.portInUseDeath = true;
        return; // original tunnel still alive, suppress the noise
      }

      if (output.toLowerCase().includes("error") || output.toLowerCase().includes("fail")) {
        logger.error("port-forward stderr", { output });
      } else {
        logger.info("port-forward stderr", { output });
      }
    });

    child.on("exit", (code, signal) => {
      this.child = null;

      if (this.stopped) return;

      // If the port is already in use, the original tunnel is still alive — no
      // need to spam retries.
      if (this.portInUseDeath) {
        this.portInUseDeath = false;
        logger.debug("port-forward exited (port already in use — original tunnel still active)", { code });
        return;
      }

      logger.warn("port-forward process exited unexpectedly", { code, signal });
      logger.info("Respawning port-forward after delay", {
        delayMs: RESPAWN_DELAY_MS,
      });
      setTimeout(() => {
        if (!this.stopped) {
          this.spawn();
        }
      }, RESPAWN_DELAY_MS);
    });

    this.child = child;
  }

  private async waitForReady(): Promise<void> {
    const { localPort, logger } = this.opts;
    const deadline = Date.now() + PROBE_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (await this.probe(localPort)) {
        logger.info("port-forward ready", { localPort });
        return;
      }
      await sleep(PROBE_INTERVAL_MS);
    }

    throw new Error(
      `port-forward not ready after ${PROBE_TIMEOUT_MS}ms on port ${localPort}`,
    );
  }

  private probe(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      let socket: Socket | null = null;

      const cleanup = () => {
        if (socket) {
          socket.removeAllListeners();
          socket.destroy();
          socket = null;
        }
      };

      socket = connect({ port, host: "127.0.0.1" }, () => {
        cleanup();
        resolve(true);
      });

      socket.on("error", () => {
        cleanup();
        resolve(false);
      });

      socket.setTimeout(1_000, () => {
        cleanup();
        resolve(false);
      });
    });
  }
}

/**
 * kubectl port-forward with verbose logging emits Go HTTP/2 transport messages
 * like "Data frame received", "Data frame handling", "Writing data frame", etc.
 * These are useless noise that drowns out actual migration progress.
 */
function isKubectlTransportNoise(output: string): boolean {
  return /Data frame (received|handling|sent)|Writing data frame/i.test(output);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
