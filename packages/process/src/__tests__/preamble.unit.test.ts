import { Config, ConfigParseError } from "@langwatch/config";
import type * as Observability from "@langwatch/observability";
import { Secret, SecretsPreflightError } from "@langwatch/secrets";
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { processConfig } from "../config.ts";
import { Server } from "../preamble.ts";
import type { ServerOptions } from "../server.ts";

const hostLines = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
const loggerNames = vi.hoisted(() => [] as string[]);
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof Observability>()),
  createLogger: (name: string) => {
    loggerNames.push(name);
    return hostLines;
  },
}));

const owner = {
  name: "github",
  config: Config.define((c) => ({ appId: c.env("GITHUB_APP_ID", z.string().optional()) })),
  secrets: { token: Secret.load("PREAMBLE_TEST_TOKEN") },
} as const;

describe("the §4 preamble", () => {
  it("parses config first and hands it to the secrets chain builder", async () => {
    const sawConfig = vi.fn();
    const server = await Server.create("preamble-test")
      .withEnvironment({ GITHUB_APP_ID: "1207", PREAMBLE_TEST_TOKEN: "tok" })
      .withConfig([owner])
      .withProcessOwnership(false)
      .withSecrets((config, secrets) => {
        sawConfig(config.github.appId);
        return secrets.withEnv();
      })
      .start();

    expect(sawConfig).toHaveBeenCalledWith("1207");
    expect((server.config as { github: { appId: string } }).github.appId).toBe("1207");
    await server.close();
  });

  it("preflights every required handle before anything constructs", async () => {
    const failure = await Server.create("preamble-test")
      .withEnvironment({})
      .withConfig([owner])
      .withProcessOwnership(false)
      .withSecrets((_, secrets) => secrets.withEnv())
      .start()
      .then(
        () => void 0,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(SecretsPreflightError);
    expect((failure as SecretsPreflightError).missing).toEqual(["PREAMBLE_TEST_TOKEN"]);
  });

  it("boots and runs the worker through resolved owner config", async () => {
    const server = await Server.create("preamble-test")
      .withEnvironment({ PREAMBLE_TEST_TOKEN: "tok" })
      .withConfig(processConfig([owner], "worker"))
      .withHealthPort(0)
      .withProcessOwnership(false)
      .withSecrets((_, secrets) => secrets.withEnv())
      .start();
    try {
      const runtime = await server
        .container("worker")
        .boot({ classifyEventLogRetention: () => "traces" });
      expect(runtime.name).toBe("worker");
      await server.run(runtime);
    } finally {
      await server.close();
    }
  });

  describe("given a module whose settings carry a required field", () => {
    const required = {
      name: "billing",
      config: Config.define((c) => ({ formId: c.env("PREAMBLE_FORM_ID", z.string()) })),
    } as const;

    /** @scenario "A misspelled required setting refuses the boot" */
    it("refuses the boot when the field arrives under a misspelled name, naming the module and the field", async () => {
      const failure = await Server.create("preamble-test")
        .withEnvironment({ PREAMBLE_FROM_ID: "form-1" })
        .withConfig([required])
        .withProcessOwnership(false)
        .withSecrets((_, secrets) => secrets.withEnv())
        .start()
        .then(
          () => void 0,
          (error: unknown) => error,
        );

      expect(failure).toBeInstanceOf(ConfigParseError);
      expect((failure as ConfigParseError).refusals).toEqual([
        expect.stringMatching(/^billing\.formId ← PREAMBLE_FORM_ID: /),
      ]);
    });
  });
});

describe("given a process that composed no telemetry, as an api embedded beside the worker", () => {
  describe("when its server writes a line", () => {
    /** @scenario "A process that composed no telemetry still writes its server's lines" */
    it("writes it once through the process's logger under the process's name", async () => {
      // The package runs with isolate: false, so a file that ran earlier in this worker may have
      // cached preamble.ts over the real logger; a fresh graph is what the mock applies to.
      vi.resetModules();
      const { Server: FreshServer } = await import("../preamble.ts");
      const { Server: FreshBoundary } = await import("../server.ts");
      const { processConfig: freshProcessConfig } = await import("../config.ts");
      const created = vi.spyOn(FreshBoundary, "create");
      const server = await FreshServer.create("embedded-api")
        .withEnvironment({})
        .withConfig(freshProcessConfig([], "api"))
        .withProcessOwnership(false)
        .start();
      const options = created.mock.calls[0]![0] as ServerOptions;
      created.mockRestore();
      hostLines.warn.mockClear();

      options.logger.warn?.(
        { code: "HPE_CLOSED_CONNECTION" },
        "http request refused before routing",
      );
      await server.close();

      expect(loggerNames).toContain("langwatch:embedded-api");
      expect(hostLines.warn).toHaveBeenCalledOnce();
      expect(hostLines.warn).toHaveBeenCalledWith(
        { code: "HPE_CLOSED_CONNECTION" },
        "http request refused before routing",
      );
    });
  });
});
