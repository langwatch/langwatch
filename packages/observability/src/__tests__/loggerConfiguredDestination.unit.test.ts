import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const loggerModule = new URL("../logger.ts", import.meta.url).href;

/**
 * Runs in a real Node process with real pino transports, as a composed worker
 * does: vitest's own logger is silent, and the defect lived in pino's worker.
 */
const script = `
import { configureLogger, createLogger } from ${JSON.stringify(loggerModule)};
createLogger("early").info("before configure");
configureLogger({
  environment: "production",
  serviceName: "langwatch-worker",
  otelExportEnabled: process.env.OTEL_EXPORT === "true",
  redactPaths: ["password"],
});
createLogger("made-after-configure").info({ password: "hunter2" }, "lazy line");
`;

async function linesWritten({ otelExport }: { otelExport: boolean }) {
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    env: {
      PATH: process.env.PATH,
      OTEL_EXPORT: String(otelExport),
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
    },
    timeout: 20_000,
  });
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line): Record<string, unknown> => JSON.parse(line));
}

describe("a logger created after configureLogger", () => {
  it.each([false, true])(
    "writes to the configured destination with its service and redaction (OTel export %s)",
    async (otelExport) => {
      const lines = await linesWritten({ otelExport });
      const lazy = lines.find((line) => line.name === "made-after-configure");

      expect(lazy).toMatchObject({
        msg: "lazy line",
        service: "langwatch-worker",
        password: "[redacted]",
      });
    },
    30_000,
  );
});
