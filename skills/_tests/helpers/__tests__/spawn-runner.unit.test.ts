import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stripApiKeys, spawnRunner } from "../spawn-runner";

describe("stripApiKeys()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      LANGWATCH_API_KEY: "lw-secret",
      OPENAI_API_KEY: "sk-secret",
      ANTHROPIC_API_KEY: "ant-secret",
      HOME: "/home/test",
      PATH: "/usr/bin",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("when API keys are present", () => {
    it("removes LANGWATCH_API_KEY, OPENAI_API_KEY, and ANTHROPIC_API_KEY", () => {
      const env = stripApiKeys();
      expect(env.LANGWATCH_API_KEY).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it("preserves non-secret environment variables", () => {
      const env = stripApiKeys();
      expect(env.HOME).toBe("/home/test");
      expect(env.PATH).toBe("/usr/bin");
    });
  });
});

describe("spawnRunner()", () => {
  describe("when the binary exits with code 0", () => {
    it("returns parsed output", async () => {
      const messages = await spawnRunner({
        binary: "echo",
        args: ["hello world"],
        workingDirectory: "/tmp",
        label: "Test",
        parseOutput: (output) => [{ text: output.trim() }],
      });

      expect(messages).toEqual([{ text: "hello world" }]);
    });
  });

  describe("when the binary exits with non-zero code", () => {
    it("rejects with an error containing the label and exit code", async () => {
      await expect(
        spawnRunner({
          binary: "bash",
          args: ["-c", "exit 42"],
          workingDirectory: "/tmp",
          label: "FailTest",
          parseOutput: () => [],
        })
      ).rejects.toThrow("FailTest command failed with exit code 42");
    });
  });

  describe("when the binary does not exist", () => {
    it("rejects with an error", async () => {
      await expect(
        spawnRunner({
          binary: "/nonexistent/binary/path",
          args: [],
          workingDirectory: "/tmp",
          label: "Missing",
          parseOutput: () => [],
        })
      ).rejects.toThrow();
    });
  });

  describe("when cleanEnv is true", () => {
    it("strips API keys from the environment", async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "test-key";

      try {
        // Use env command to print environment, then check the key is absent
        const messages = await spawnRunner({
          binary: "env",
          args: [],
          workingDirectory: "/tmp",
          cleanEnv: true,
          label: "EnvTest",
          parseOutput: (output) => {
            const hasKey = output.includes("OPENAI_API_KEY");
            return [{ apiKeyPresent: hasKey }];
          },
        });

        expect(messages).toEqual([{ apiKeyPresent: false }]);
      } finally {
        if (originalKey !== undefined) {
          process.env.OPENAI_API_KEY = originalKey;
        } else {
          delete process.env.OPENAI_API_KEY;
        }
      }
    });
  });
});
