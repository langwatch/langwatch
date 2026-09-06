import { describe, expect, it } from "vitest";
import { DevGeneratedSecretSource } from "../dev-generated.secret-source.ts";
import { ProcessRunnerPort, type ProcessResult } from "../process-runner.port.ts";
import { SecretMigrationService } from "../secret-migration.service.ts";

class FakeRunner extends ProcessRunnerPort {
  readonly calls: { command: string; args: readonly string[] }[] = [];

  constructor(private readonly answer: (args: readonly string[]) => ProcessResult) {
    super();
  }

  run({ command, args }: { command: string; args: readonly string[] }): Promise<ProcessResult> {
    this.calls.push({ args, command });

    return Promise.resolve(this.answer(args));
  }
}

const ITEM = { item: "langwatch-dev", vault: "Engineering" } as const;

function accepting(): FakeRunner {
  return new FakeRunner(() => ({ code: 0, stderr: "", stdout: "" }));
}

function rejectingEdit(): FakeRunner {
  return new FakeRunner((args) =>
    args[1] === "edit"
      ? { code: 1, stderr: '[ERROR] "langwatch-dev" isn\'t an item', stdout: "" }
      : { code: 0, stderr: "", stdout: "" },
  );
}

describe("given a first launch with a vault configured", () => {
  describe("when the dev-only secrets are generated", () => {
    /** @scenario "Generated development secrets are written to the vault, not to .env" */
    it("writes each generated key into the profile item", async () => {
      const runner = accepting();
      const source = DevGeneratedSecretSource.create({ item: ITEM, runner });

      const generated = await source.resolve({
        keys: ["LW_GATEWAY_JWT_SECRET", "LANGY_INTERNAL_SECRET", "OPENAI_API_KEY"],
      });

      expect([...generated.keys()].sort()).toEqual([
        "LANGY_INTERNAL_SECRET",
        "LW_GATEWAY_JWT_SECRET",
      ]);
      expect(generated.get("LW_GATEWAY_JWT_SECRET")).toMatch(/^[0-9a-f]{64}$/);
      expect(runner.calls[0]?.args.slice(0, 4)).toEqual([
        "item",
        "edit",
        "langwatch-dev",
        "--vault",
      ]);
    });

    /** @scenario "A provider key is never invented" */
    it("never generates a key the registry does not mark generate", async () => {
      const runner = accepting();
      const source = DevGeneratedSecretSource.create({ item: ITEM, runner });

      expect(await source.resolve({ keys: ["OPENAI_API_KEY"] })).toEqual(new Map());
      expect(runner.calls).toEqual([]);
    });

    /** @scenario "The item is created when it does not exist yet" */
    it("creates the item after the edit misses", async () => {
      const runner = rejectingEdit();

      await DevGeneratedSecretSource.create({ item: ITEM, runner }).resolve({
        keys: ["LW_GATEWAY_JWT_SECRET"],
      });

      expect(runner.calls.map(({ args }) => args[1])).toEqual(["edit", "create"]);
    });
  });
});

describe("given a .env holding secrets and configuration", () => {
  describe("when it is pushed to the vault", () => {
    /** @scenario "Migrating .env moves the secrets and leaves configuration alone" */
    it("moves the secret lines and rewrites them as references", async () => {
      const runner = accepting();
      const envFile = [
        "# provider keys",
        "OPENAI_API_KEY=sk-live-abc",
        'SMTP_PASSWORD="hunter2"',
        "BASE_HOST=http://localhost:5560",
        "S3_BUCKET_NAME=langwatch-dev",
        "GROQ_API_KEY=",
      ].join("\n");

      const report = await SecretMigrationService.create({ item: ITEM, runner }).push({ envFile });

      expect([...report.moved].sort()).toEqual(["OPENAI_API_KEY", "SMTP_PASSWORD"]);
      expect(report.envFile).toBe(
        [
          "# provider keys",
          "OPENAI_API_KEY=op://Engineering/langwatch-dev/OPENAI_API_KEY",
          "SMTP_PASSWORD=op://Engineering/langwatch-dev/SMTP_PASSWORD",
          "BASE_HOST=http://localhost:5560",
          "S3_BUCKET_NAME=langwatch-dev",
          "GROQ_API_KEY=",
        ].join("\n"),
      );
      expect(report.envFile).not.toContain("sk-live-abc");
      expect(report.envFile).not.toContain("hunter2");
    });

    /** @scenario "A key already holding a reference is left alone" */
    it("reports an existing reference and does not rewrite it", async () => {
      const runner = accepting();

      const report = await SecretMigrationService.create({ item: ITEM, runner }).push({
        envFile: "OPENAI_API_KEY=op://Engineering/langwatch-dev/OPENAI_API_KEY",
      });

      expect(report.alreadyReferences).toEqual(["OPENAI_API_KEY"]);
      expect(report.moved).toEqual([]);
      expect(runner.calls).toEqual([]);
    });

    /** @scenario "Keeping the file leaves it byte for byte" */
    it("writes the vault and leaves the file untouched when asked to keep it", async () => {
      const runner = accepting();
      const envFile = "OPENAI_API_KEY=sk-live-abc";

      const report = await SecretMigrationService.create({ item: ITEM, runner }).push({
        envFile,
        rewrite: false,
      });

      expect(report.moved).toEqual(["OPENAI_API_KEY"]);
      expect(report.envFile).toBe(envFile);
      expect(runner.calls).toHaveLength(1);
    });
  });
});
