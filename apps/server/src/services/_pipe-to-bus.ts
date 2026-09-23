import type { Readable } from "node:stream";

import { execa, type Options as ExecaOptions, type ResultPromise } from "execa";

import type { EventBus } from "./event-bus.ts";

// Capture child stdout/stderr line-by-line to EventBus for parallel install steps.
export async function execAndPipe({
  bus,
  service,
  bin,
  args,
  options = {},
}: {
  bus: EventBus;
  service: string;
  bin: string;
  args: string[];
  options?: ExecaOptions;
}): Promise<void> {
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

  pipeStream({ stream: child.stdout, bus, service, kind: "stdout" });
  pipeStream({ stream: child.stderr, bus, service, kind: "stderr" });

  await child;
}

function pipeStream({
  stream,
  bus,
  service,
  kind,
}: {
  stream: Readable | undefined | null;
  bus: EventBus;
  service: string;
  kind: "stdout" | "stderr";
}): void {
  if (!stream) return;
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
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
