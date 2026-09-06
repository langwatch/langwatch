import { describe, expect, it } from "vitest";
import {
  OnePasswordSecretSource,
  OnePasswordUnavailableError,
} from "../one-password.secret-source.ts";
import { ProcessRunnerPort, type ProcessResult } from "../process-runner.port.ts";

class FakeRunner extends ProcessRunnerPort {
  readonly calls: { command: string; args: readonly string[]; input?: string }[] = [];

  constructor(private readonly answer: (input: string) => ProcessResult) {
    super();
  }

  run(call: { command: string; args: readonly string[]; input?: string }): Promise<ProcessResult> {
    this.calls.push(call);

    return Promise.resolve(this.answer(call.input ?? ""));
  }
}

function injecting(values: Record<string, string>): FakeRunner {
  return new FakeRunner((input) => ({
    code: 0,
    stderr: "",
    stdout: input
      .split("\n")
      .map((line) => {
        const key = line.slice(0, line.indexOf("="));
        return `${key}=${values[key] ?? line.slice(line.indexOf("=") + 1)}`;
      })
      .join("\n"),
  }));
}

describe("given a secret key whose value is an op:// reference", () => {
  describe("when the 1Password source resolves it", () => {
    /** @scenario "An op reference in the environment is resolved" */
    it("asks the CLI once for the batch and returns the referenced value", async () => {
      const runner = injecting({ OPENAI_API_KEY: "sk-from-vault" });
      const source = OnePasswordSecretSource.create({
        environment: { OPENAI_API_KEY: "op://Private/openai/credential" },
        runner,
      });

      const found = await source.resolve({ keys: ["OPENAI_API_KEY"] });

      expect(found.get("OPENAI_API_KEY")).toBe("sk-from-vault");
      expect(runner.calls).toHaveLength(1);
      expect(runner.calls[0]?.command).toBe("op");
      expect(runner.calls[0]?.input).toBe("OPENAI_API_KEY=op://Private/openai/credential");
    });
  });
});

describe("given a vault is named and a secret key has no value", () => {
  describe("when the 1Password source resolves it", () => {
    /** @scenario "A missing secret is looked up under the configured profile" */
    it("asks under the langwatch item for the configured profile", async () => {
      const runner = injecting({ GROQ_API_KEY: "gsk-from-vault" });
      const source = OnePasswordSecretSource.create({
        environment: {
          LANGWATCH_SECRETS_PROFILE: "alex",
          LANGWATCH_SECRETS_VAULT: "Engineering",
        },
        runner,
      });

      const found = await source.resolve({ keys: ["GROQ_API_KEY"] });

      expect(runner.calls[0]?.input).toBe(
        "GROQ_API_KEY=op://Engineering/langwatch-alex/GROQ_API_KEY",
      );
      expect(found.get("GROQ_API_KEY")).toBe("gsk-from-vault");
    });
  });

  describe("when no profile is set", () => {
    /** @scenario "The profile defaults rather than being keyed on the worktree" */
    it("builds the dev profile item", async () => {
      const runner = injecting({});
      const source = OnePasswordSecretSource.create({
        environment: { LANGWATCH_SECRETS_VAULT: "Engineering" },
        runner,
      });

      await source.resolve({ keys: ["GROQ_API_KEY"] });

      expect(runner.calls[0]?.input).toBe(
        "GROQ_API_KEY=op://Engineering/langwatch-dev/GROQ_API_KEY",
      );
    });
  });
});

describe("given the CLI exits non-zero because the session is not unlocked", () => {
  describe("when the 1Password source resolves a key", () => {
    /** @scenario "Being signed out is not a miss" */
    it("fails with the unlock instruction rather than falling through", async () => {
      const source = OnePasswordSecretSource.create({
        environment: { OPENAI_API_KEY: "op://Private/openai/credential" },
        runner: new FakeRunner(() => ({
          code: 1,
          stderr: "[ERROR] you are not currently signed in",
          stdout: "",
        })),
      });

      await expect(source.resolve({ keys: ["OPENAI_API_KEY"] })).rejects.toThrow(
        OnePasswordUnavailableError,
      );
      await expect(source.resolve({ keys: ["OPENAI_API_KEY"] })).rejects.toThrow(/op signin/);
    });
  });
});

describe("given the CLI reports that no item matched", () => {
  describe("when the 1Password source resolves a key", () => {
    /** @scenario "An item that does not exist falls through to the next source" */
    it("answers nothing", async () => {
      const source = OnePasswordSecretSource.create({
        environment: { LANGWATCH_SECRETS_VAULT: "Engineering" },
        runner: new FakeRunner(() => ({
          code: 1,
          stderr: '[ERROR] "langwatch-dev" isn\'t an item in the "Engineering" vault',
          stdout: "",
        })),
      });

      expect(await source.resolve({ keys: ["GROQ_API_KEY"] })).toEqual(new Map());
    });
  });
});

describe("given no vault and a plain value", () => {
  describe("when the 1Password source resolves it", () => {
    it("never runs the CLI", async () => {
      const runner = injecting({});
      const source = OnePasswordSecretSource.create({
        environment: { OPENAI_API_KEY: "sk-plain" },
        runner,
      });

      expect(await source.resolve({ keys: ["OPENAI_API_KEY"] })).toEqual(new Map());
      expect(runner.calls).toEqual([]);
    });
  });
});
