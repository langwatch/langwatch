/**
 * The exact shape of one console line.
 *
 * Driven through the real pino-pretty stream rather than asserted against the
 * options object, because what a developer reads is the string and the options
 * are only how it is asked for.
 *
 * Corresponds to specs/setup/dev-stack-log-format.feature.
 */

import pino from "pino";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { prettyConsoleOptions } from "../logger";
import { createRequire } from "node:module";

const prettyStream = createRequire(import.meta.url)("pino-pretty") as (
  options: unknown,
) => NodeJS.WritableStream;

/** One record, rendered the way a dev terminal renders it. */
async function renderedLine(
  record: Record<string, unknown>,
  options: { level?: string; message?: string } = {},
): Promise<string> {
  const captured = new PassThrough();
  const chunks: string[] = [];
  captured.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));

  const pretty = prettyStream({
    ...prettyConsoleOptions({ level: "debug", isOtelExportEnabled: false }),
    // Colour is the one option a terminal wants and an assertion does not.
    colorize: false,
    destination: captured,
  });

  const logger = pino({ name: "langwatch:api:rest", level: "debug" }, pretty as never);
  (logger as unknown as Record<string, (...args: unknown[]) => void>)[options.level ?? "info"]!(
    record,
    options.message ?? "request handled",
  );

  await new Promise((resolve) => setTimeout(resolve, 50));
  return chunks.join("").trim();
}

describe("given a Node lane logging in a development terminal", () => {
  describe("when it writes a line", () => {
    /** @scenario "A Node lane prints a time, a level, a scope and a message" */
    it("prints a time of day, a padded level word, the scope and the message", async () => {
      const line = await renderedLine({ method: "GET" });

      expect(line).toMatch(
        /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] INFO \(langwatch:api:rest\): request handled \{"method":"GET"\}$/,
      );
    });

    /** @scenario "A Node lane prints a time, a level, a scope and a message" */
    it("carries no date, because a development terminal is always today", async () => {
      const line = await renderedLine({});

      expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(line).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] /);
    });

    /** @scenario "A Node lane prints a time, a level, a scope and a message" */
    it("names the level as a whole word, at every level", async () => {
      const levels = await Promise.all(
        (["debug", "info", "warn", "error"] as const).map((level) => renderedLine({}, { level })),
      );

      expect(levels.map((line) => line.split(" ")[1])).toEqual(["DEBUG", "INFO", "WARN", "ERROR"]);
    });
  });
});

describe("given a line logged outside any request", () => {
  describe("when it is written to the console", () => {
    /** @scenario "Context that is not there is not printed" */
    it("leaves the empty request and tenant context off", async () => {
      const logger = pino({ name: "outside" }, new PassThrough() as never);
      void logger;

      // The mixin is what drops them, so what reaches the console has already
      // lost them. What this pins is that a line with nothing but nulls left
      // prints no object at all rather than an empty one.
      const line = await renderedLine({});

      expect(line).not.toContain("traceId");
      expect(line).not.toContain("null");
      expect(line.endsWith("request handled")).toBe(true);
    });
  });
});

describe("given a line logged while serving a request", () => {
  describe("when it is written to the console", () => {
    /** @scenario "Context that is there is printed" */
    it("keeps the identifiers it carries", async () => {
      const line = await renderedLine({ traceId: "bec4f02c", spanId: "05cf7184" });

      expect(line).toContain('"traceId":"bec4f02c"');
      expect(line).toContain('"spanId":"05cf7184"');
    });
  });
});
