/**
 * The version as it appears on a record `createLogger` actually wrote.
 *
 * `serviceVersion.unit.test.ts` tests the parser in isolation, and a parser test
 * passes perfectly well while the emitted record carries nothing — the field
 * only reaches a log line if the parser is wired into pino's `bindings`
 * formatter, and nothing in a direct call proves that it is. So this goes
 * through `createLogger` and reads what lands on the stream.
 *
 * `createLogger` writes to `process.stdout` when there is no transport, which is
 * the case under NODE_ENV=test, so intercepting the write is enough to see the
 * real record.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../logger";

const ORIGINAL_ENV = { ...process.env };

/** Everything createLogger wrote while `run` executed, parsed. */
function emitted(run: () => void): Record<string, any>[] {
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
    .map((line) => JSON.parse(line) as Record<string, any>);
}

describe("service.version on a record createLogger wrote", () => {
  beforeEach(() => {
    delete process.env.SERVICE_VERSION;
    delete process.env.OTEL_RESOURCE_ATTRIBUTES;
    // The node logger defaults to `error` under NODE_ENV=test; these assertions
    // are about an ordinary info line.
    process.env.PINO_LOG_LEVEL = "info";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("reaches the emitted line, not just the parser", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "service.name=langwatch-app,service.version=git-5373dad";

    const [record] = emitted(() => {
      createLogger("langwatch:test:version").info("hello");
    });

    expect(record?.["service.version"]).toBe("git-5373dad");
  });

  it("decodes a percent-encoded value, so it matches what the trace says", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "service.version=git%2Dabc%2C1";

    const [record] = emitted(() => {
      createLogger("langwatch:test:version").info("hello");
    });

    expect(record?.["service.version"]).toBe("git-abc,1");
  });

  it("is absent, not empty, when the environment says nothing", () => {
    const [record] = emitted(() => {
      createLogger("langwatch:test:version").info("hello");
    });

    expect(record).not.toHaveProperty("service.version");
  });

  it("does not disturb the fields the record already carried", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "service.version=git-5373dad";

    const [record] = emitted(() => {
      createLogger("langwatch:test:version").info("hello");
    });

    expect(record?.name).toBe("langwatch:test:version");
    expect(record?.msg).toBe("hello");
    expect(record?.service).toBeTruthy();
  });
});
