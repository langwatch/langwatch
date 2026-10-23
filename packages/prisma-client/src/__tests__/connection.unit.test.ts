/**
 * Which logger level `forwardPrismaEvent` routes an event to: handled and
 * retried P2002/P2034 races and a schema-behind upgrade downgrade to `warn`,
 * everything else keeps its own level (#944).
 */

import type { Logger } from "@langwatch/observability";
import { describe, expect, it, vi } from "vitest";

import { forwardPrismaEvent } from "../connection.ts";
import type { Prisma } from "../generated/client.ts";

/** A log event carries only `message` text — no `code` field — so the fix matches wording. */
const at = new Date("2026-10-14T13:20:00Z");

function event(target: string, message: string): Prisma.LogEvent {
  return { timestamp: at, target, message };
}

/** P2002/P2034 render as human text; P-codes live on the thrown error, not the log event. */
const p2002 = event(
  "promptTag.create",
  "Unique constraint failed on the fields: (`organizationId`,`name`)",
);
const p2034 = event(
  "langyActiveTurn.findUnique",
  "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
);
const schemaBehind = event(
  "someModel.findMany",
  "The table `public.Foo` does not exist in the current database.",
);
const unrelated = event("user.findUnique", "Something else went wrong");

function stubLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger & Record<"error" | "warn" | "info" | "debug", ReturnType<typeof vi.fn>>;
}

describe("forwardPrismaEvent", () => {
  it("downgrades a handled P2002 unique-constraint error to warn", () => {
    const logger = stubLogger();

    forwardPrismaEvent({ logger, level: "error", event: p2002 });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { target: p2002.target, message: p2002.message, timestamp: at },
      "prisma error",
    );
  });

  it("downgrades a handled P2034 write-conflict/deadlock error to warn", () => {
    const logger = stubLogger();

    forwardPrismaEvent({ logger, level: "error", event: p2034 });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("still logs an unrelated error at error", () => {
    const logger = stubLogger();

    forwardPrismaEvent({ logger, level: "error", event: unrelated });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("still downgrades a schema-behind error to warn", () => {
    const logger = stubLogger();

    forwardPrismaEvent({ logger, level: "error", event: schemaBehind });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("leaves a non-error level at its own level", () => {
    const logger = stubLogger();

    forwardPrismaEvent({ logger, level: "warn", event: unrelated });
    forwardPrismaEvent({ logger, level: "info", event: unrelated });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
