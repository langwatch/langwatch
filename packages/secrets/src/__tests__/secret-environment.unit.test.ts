import { describe, expect, it } from "vitest";
import { ProcessRunnerPort, type ProcessResult } from "../process-runner.port.ts";
import {
  SecretEnvironmentService,
  secretResolutionSummary,
} from "../secret-environment.service.ts";

class CountingRunner extends ProcessRunnerPort {
  runs = 0;

  run(): Promise<ProcessResult> {
    this.runs += 1;

    return Promise.resolve({ code: 0, stderr: "", stdout: "" });
  }
}

describe("given a production environment with a vault named", () => {
  describe("when the environment is resolved", () => {
    /** @scenario "Production never constructs the 1Password source" */
    it("runs no subprocess", async () => {
      const runner = new CountingRunner();
      const resolution = await SecretEnvironmentService.create({
        runner,
        source: {
          LANGWATCH_SECRETS_VAULT: "Engineering",
          NODE_ENV: "production",
          OPENAI_API_KEY: "sk-from-pod",
        },
      }).resolve();

      expect(runner.runs).toBe(0);
      expect(resolution.environment.OPENAI_API_KEY).toBe("sk-from-pod");
      expect(resolution.attribution).toEqual([{ key: "OPENAI_API_KEY", source: "env" }]);
    });
  });
});

describe("given an environment holding configuration and secrets", () => {
  describe("when it is resolved", () => {
    /** @scenario "The resolved environment is a new frozen record" */
    it("returns a frozen copy and leaves the process environment alone", async () => {
      const source = { BASE_HOST: "http://localhost:5560", OPENAI_API_KEY: "sk-live" };
      const before = process.env.OPENAI_API_KEY;

      const resolution = await SecretEnvironmentService.create({ source }).resolve();

      expect(Object.isFrozen(resolution.environment)).toBe(true);
      expect(resolution.environment).not.toBe(source);
      expect(resolution.environment.BASE_HOST).toBe("http://localhost:5560");
      expect(process.env.OPENAI_API_KEY).toBe(before);
    });
  });
});

describe("given an environment holding no classified secret", () => {
  describe("when it is resolved", () => {
    /** @scenario "An unconfigured checkout resolves nothing and still boots" */
    it("summarises that nothing was resolved and raises no refusal", async () => {
      const resolution = await SecretEnvironmentService.create({
        source: { BASE_HOST: "http://localhost:5560" },
      }).resolve();

      expect(resolution.attribution).toEqual([]);
      expect(secretResolutionSummary(resolution)).toBe("no classified secret was resolved");
    });
  });
});

describe("given a chain that resolved secrets", () => {
  describe("when the boot summary is built", () => {
    it("names each key and its source and carries no value", () => {
      const summary = secretResolutionSummary({
        attribution: [
          { key: "OPENAI_API_KEY", source: "1password" },
          { key: "DATABASE_URL", source: "env" },
        ],
      });

      expect(summary).toBe("OPENAI_API_KEY=<1password> DATABASE_URL=<env>");
    });
  });
});
