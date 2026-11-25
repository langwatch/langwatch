import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";

import { execa, type Options as ExecaOptions, type ResultPromise } from "execa";

import type { EventBus } from "./event-bus.ts";

/**
 * Runs one install step, writing its output to `<logsDir>/<service>.log` and, line by line, to
 * the bus: the terminal shows it only when verbose (spec 11-terminal-output).
 */
export async function execAndPipe({
  bus,
  service,
  bin,
  args,
  logsDir,
  options = {},
}: {
  bus: EventBus;
  service: string;
  bin: string;
  args: string[];
  logsDir: string;
  options?: ExecaOptions;
}): Promise<void> {
  mkdirSync(logsDir, { recursive: true });
  const logFile = createWriteStream(join(logsDir, `${service}.log`), { flags: "a" });
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

  pipeStream({ stream: child.stdout, bus, service, kind: "stdout", logFile });
  pipeStream({ stream: child.stderr, bus, service, kind: "stderr", logFile });

  try {
    await child;
  } finally {
    logFile.end();
  }
}

function pipeStream({
  stream,
  bus,
  service,
  kind,
  logFile,
}: {
  stream: Readable | undefined | null;
  bus: EventBus;
  service: string;
  kind: "stdout" | "stderr";
  logFile: WriteStream;
}): void {
  if (!stream) return;
  const record = (line: string) => {
    if (!logFile.writableEnded) logFile.write(`${line}\n`);
  };
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.length > 0) {
        record(line);
        bus.emit({ type: "log", service, stream: kind, line });
      }
    }
  });
  stream.on("end", () => {
    if (buf.length > 0) {
      record(buf);
      bus.emit({ type: "log", service, stream: kind, line: buf });
      buf = "";
    }
  });
}
