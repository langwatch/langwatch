import { spawn, type ChildProcess } from "node:child_process";
import { connect, type Socket } from "node:net";
import type { Logger } from "./lib/types.js";

const RESPAWN_DELAY_MS = 1_000;
const PROBE_INTERVAL_MS = 200;
const PROBE_TIMEOUT_MS = 30_000;

export interface PortForwardStartOptions {
  /**
   * Verify that the tunnel actually speaks to the expected service — e.g.
   * by issuing a cheap ping to the underlying backend. Runs once after the
   * local port becomes reachable. If it throws, `start()` rejects with a
   * descriptive error that explains the likely cause (another process
   * holding the port).
   */
  identityCheck?: () => Promise<void>;
}

export class PortForward {
  private child: ChildProcess | null = null;
  private stopped = false;
  private portInUseDeath = false;
  private spawnError: Error | null = null;

  constructor(
    private readonly opts: {
      service: string;
      localPort: number;
      remotePort: number;
      namespace?: string;
      logger: Logger;
    },
  ) {}

  async start(startOpts: PortForwardStartOptions = {}): Promise<void> {
    this.stopped = false;
    this.spawnError = null;
    this.spawn();
    await this.waitForReady();

    if (startOpts.identityCheck) {
      try {
        await startOpts.identityCheck();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        throw new Error(
          `port-forward on localhost:${this.opts.localPort} came up but identity check failed — another process may be holding this port. Original error: ${message}`,
        );
      }
    }
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

    // Capture spawn failures (e.g. ENOENT if kubectl is not on PATH) so
    // waitForReady() can reject promptly instead of polling to its deadline.
    child.on("error", (err: Error) => {
      this.spawnError = err;
      logger.error("kubectl port-forward failed to spawn", {
        error: err.message,
      });
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
      if (this.spawnError) {
        throw new Error(
          `port-forward failed to spawn: ${this.spawnError.message}`,
        );
      }
      if (await this.probe(localPort)) {
        logger.info("port-forward ready", { localPort });
        return;
      }
      await sleep(PROBE_INTERVAL_MS);
    }

    if (this.spawnError) {
      throw new Error(
        `port-forward failed to spawn: ${this.spawnError.message}`,
      );
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
