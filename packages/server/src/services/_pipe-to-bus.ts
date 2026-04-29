import { execa, type Options as ExecaOptions, type ResultPromise } from "execa";
import type { Readable } from "node:stream";
import type { EventBus } from "./event-bus.ts";

/**
 * execa wrapper that captures child stdout/stderr line-by-line and emits
 * them to the EventBus as `log` events instead of dumping straight to the
 * parent's stdio. Using this for installer children (pnpm install, uv sync,
 * prisma migrate, …) prevents character-level interleave when multiple
 * children run in parallel — each line carries its service name and the
 * CLI's animation layer can render bounded per-service panels.
 *
 * Use with parallel install steps. For long-running supervised services
 * (postgres, redis, …) keep using supervise() — its tee infra is already
 * piping to the bus + log files.
 */
export async function execAndPipe(
  bus: EventBus,
  service: string,
  bin: string,
  args: string[],
  options: ExecaOptions = {},
): Promise<void> {
  const child = execa(bin, args, {
    ...options,
    // ignore stdin (none of these install steps are interactive); pipe both
    // stdout and stderr so we can re-emit as bus log events. Even when an
    // installer is silent on stdout, error output (resolution failures,
    // build script crashes) lands on stderr — both must flow to the user.
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  }) as ResultPromise<ExecaOptions & { stdout: "pipe"; stderr: "pipe" }>;

  pipeStream(child.stdout, bus, service, "stdout");
  pipeStream(child.stderr, bus, service, "stderr");

  await child;
}

function pipeStream(
  stream: Readable | undefined | null,
  bus: EventBus,
  service: string,
  kind: "stdout" | "stderr",
): void {
  if (!stream) return;
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    // eslint-disable-next-line no-cond-assign
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.length > 0) {
        bus.emit({ type: "log", service, stream: kind, line });
      }
    }
  });
  stream.on("end", () => {
    if (buf.length > 0) {
      bus.emit({ type: "log", service, stream: kind, line: buf });
      buf = "";
    }
  });
}
