// @vitest-environment node
import { Config } from "@langwatch/config";
import { createLoggerFactory } from "@langwatch/observability";
import { REDACTED, Secret } from "@langwatch/secrets";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { Server } from "../server-factory.ts";

const SECRET_VALUE = "sk-preamble-do-not-log";

const owner = {
  name: "vendor",
  config: Config.define((c) => ({ region: c.env("VENDOR_REGION", z.string().optional()) })),
  secrets: { token: Secret.load("PREAMBLE_REDACTION_TOKEN") },
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the preamble's log redaction", () => {
  describe("given an owner that declares a secret", () => {
    it("masks the secret's value in a log line, bare or one level down", async () => {
      vi.stubEnv("PREAMBLE_REDACTION_TOKEN", SECRET_VALUE);
      const lines: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
        lines.push(String(chunk));
        return true;
      });

      const server = await Server.create("secret-redaction-test")
        .withConfig([owner])
        .withProcessOwnership(false)
        .withSecrets((_, secrets) => secrets.withEnv())
        .withTelemetry(({ redactPaths }) => {
          const logger = createLoggerFactory({
            environment: "test",
            level: "info",
            redactPaths,
          }).createLogger("secret-redaction");
          logger.info({ PREAMBLE_REDACTION_TOKEN: SECRET_VALUE }, "bare");
          logger.info({ config: { PREAMBLE_REDACTION_TOKEN: SECRET_VALUE } }, "nested");
          return { logger };
        })
        .start();
      await server.close();
      vi.restoreAllMocks();

      const output = lines.join("");
      expect(output).toContain(REDACTED);
      expect(output).not.toContain(SECRET_VALUE);
    });
  });
});
