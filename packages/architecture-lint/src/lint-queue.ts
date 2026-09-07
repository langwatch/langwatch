import { createServer, type Server } from "node:net";
import { setTimeout } from "node:timers/promises";

// Loopback listeners are OS-owned locks: shared across worktrees and released
// even on SIGKILL. Keep these ports stable across versions of the CLI.
const SLOT_PORTS = [47381, 47382] as const;

function trySlot(port: number): Promise<Server | undefined> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once("error", (error) => {
      if ("code" in error && error.code === "EADDRINUSE") {
        resolve(void 0);
      } else {
        reject(error);
      }
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => resolve(server));
  });
}

async function runWithSlot(slot: Server, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } finally {
    await new Promise<void>((resolve, reject) => {
      slot.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

/** Wait before loading the lint engine; blocked callers retain no TypeScript ASTs. */
export async function withArchitectureLintSlot(
  run: () => Promise<void>,
  ports: readonly [number, number] = SLOT_PORTS,
): Promise<void> {
  let announced = false;
  while (true) {
    for (const port of ports) {
      const slot = await trySlot(port);
      if (!slot) continue;

      if (announced) process.stderr.write("architecture-lint: slot available, starting\n");

      await runWithSlot(slot, run);

      return;
    }

    if (!announced) {
      process.stderr.write(
        "architecture-lint: waiting for a slot (maximum 2 running per machine)\n",
      );
      announced = true;
    }

    await setTimeout(500 + Math.floor(Math.random() * 250));
  }
}
