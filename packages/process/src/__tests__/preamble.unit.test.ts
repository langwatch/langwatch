import { Config, ConfigParseError } from "@langwatch/config";
import { Secret, SecretsPreflightError } from "@langwatch/secrets";
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { processConfig } from "../config.ts";
import { Server } from "../server-factory.ts";

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
      const runtime = await server.container("worker").boot();
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
