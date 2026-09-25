// @vitest-environment node
import { ACTOR_SECRET_LOG_PATHS, type Actor } from "@langwatch/actor";
import { createLoggerFactory, type LoggerConfiguration } from "@langwatch/observability";
import { processTelemetry } from "@langwatch/observability/node";
import { REDACTED } from "@langwatch/secrets";
import { afterEach, describe, expect, it, vi } from "vitest";

import { processConfig } from "../config.ts";
import { Server } from "../server-factory.ts";

const TOKEN_KEY = "lwcli:access:lw_at_do_not_log";

const ACTOR: Actor = {
  type: "user",
  id: "user-1",
  cliSession: { tokenKey: TOKEN_KEY, cliApiKeyId: "key-1" },
};

afterEach(() => vi.restoreAllMocks());

function logActor(configuration: LoggerConfiguration): string {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  });
  const logger = createLoggerFactory({ environment: "test", level: "info", ...configuration });
  logger.createLogger("actor-redaction").info({ actor: ACTOR }, "cli caller");
  logger.createLogger("actor-redaction-bare").info(ACTOR, "cli caller");
  vi.restoreAllMocks();

  return lines.join("");
}

describe("logging an actor that carries a CLI session", () => {
  describe("given the actor's secret paths", () => {
    it("masks the token key, bare or under a field, and keeps the rest", () => {
      const output = logActor({ redactPaths: ACTOR_SECRET_LOG_PATHS });

      expect(output).not.toContain(TOKEN_KEY);
      expect(output).toContain(REDACTED);
      expect(output).toContain("key-1");
    });
  });

  describe("given no redaction paths", () => {
    it("writes the token key, which is what the paths exist to stop", () => {
      expect(logActor({})).toContain(TOKEN_KEY);
    });
  });
});

describe("the preamble's telemetry slot", () => {
  it("hands the telemetry factory the actor's secret paths", async () => {
    let seen: readonly string[] = [];
    const server = await Server.create("actor-redaction-test")
      .withConfig(processConfig([], "worker"))
      .withHealthPort(0)
      .withProcessOwnership(false)
      .withSecrets((_, secrets) => secrets.withEnv())
      .withTelemetry((context) => {
        seen = context.redactPaths;
        return processTelemetry("actor-redaction-test")(context);
      })
      .start();

    expect(seen).toEqual(expect.arrayContaining([...ACTOR_SECRET_LOG_PATHS]));
    await server.close();
  });
});
