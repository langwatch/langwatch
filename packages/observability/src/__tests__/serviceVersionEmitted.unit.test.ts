/** The version as it appears on a record `createLogger` actually wrote. */

import { beforeEach, describe, expect, it } from "vitest";

import { configureLogger, createLogger, resetLoggerCache } from "../logger.ts";

/** Everything createLogger wrote while `run` executed, parsed. */
function emitted(run: () => void): Record<string, unknown>[] {
  const written: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    run();
  } finally {
    process.stdout.write = realWrite;
  }

  return written
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("service.version on a record createLogger wrote", () => {
  beforeEach(() => {
    configureLogger({ environment: "test", level: "info" });
    resetLoggerCache();
  });

  it("reaches the emitted line, not just the parser", () => {
    configureLogger({ environment: "test", level: "info", serviceVersion: "git-5373dad" });
    resetLoggerCache();

    const [record] = emitted(() => {
      createLogger("langwatch:test:version").info("hello");
    });

    expect(record?.["service.version"]).toBe("git-5373dad");
  });

  it("uses the configured version, so it matches the trace resource", () => {
    configureLogger({ environment: "test", level: "info", serviceVersion: "git-abc,1" });
    resetLoggerCache();

    const [record] = emitted(() => {
      createLogger("langwatch:test:version").info("hello");
    });

    expect(record?.["service.version"]).toBe("git-abc,1");
  });

  it("is absent, not empty, when configuration says nothing", () => {
    const [record] = emitted(() => {
      createLogger("langwatch:test:version").info("hello");
    });

    expect(record).not.toHaveProperty("service.version");
  });

  it("does not disturb the fields the record already carried", () => {
    configureLogger({ environment: "test", level: "info", serviceVersion: "git-5373dad" });
    resetLoggerCache();

    const [record] = emitted(() => {
      createLogger("langwatch:test:version").info("hello");
    });

    expect(record?.name).toBe("langwatch:test:version");
    expect(record?.msg).toBe("hello");
    expect(record?.service).toBeTruthy();
  });
});
