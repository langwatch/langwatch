import { describe, expect, it } from "vitest";
import { ChainedSecretSource } from "../chained.secret-source.ts";
import { EnvSecretSource } from "../env.secret-source.ts";
import { MissingSecretsError, RefusingSecretSource } from "../refusing.secret-source.ts";
import { SecretSource } from "../secret-source.port.ts";

class RecordingSource extends SecretSource {
  readonly asked: string[][] = [];

  constructor(
    readonly name: string,
    private readonly held: Record<string, string>,
  ) {
    super();
  }

  resolve({ keys }: { keys: readonly string[] }): Promise<Map<string, string>> {
    this.asked.push([...keys]);
    const found = new Map<string, string>();
    for (const key of keys) {
      const value = this.held[key];
      if (value !== undefined) found.set(key, value);
    }

    return Promise.resolve(found);
  }
}

describe("given two sources that both hold a key", () => {
  describe("when the chain resolves it", () => {
    /** @scenario "The first source with an answer wins" */
    it("takes the first source's value and never asks the second for it", async () => {
      const first = new RecordingSource("first", { OPENAI_API_KEY: "from-first" });
      const second = new RecordingSource("second", { OPENAI_API_KEY: "from-second" });
      const chain = ChainedSecretSource.create({ sources: [first, second] });

      const found = await chain.resolve({ keys: ["OPENAI_API_KEY"] });

      expect(found.get("OPENAI_API_KEY")).toBe("from-first");
      expect(second.asked).toEqual([]);
    });
  });
});

describe("given a chain that resolved a secret", () => {
  describe("when its attribution is read", () => {
    /** @scenario "The chain reports the source by name and never the value" */
    it("carries the key name and the source name only", async () => {
      const chain = ChainedSecretSource.create({
        sources: [new RecordingSource("env", { GROQ_API_KEY: "gsk-secret" })],
      });
      await chain.resolve({ keys: ["GROQ_API_KEY"] });

      expect(chain.attribution()).toEqual([{ key: "GROQ_API_KEY", source: "env" }]);
      expect(JSON.stringify(chain.attribution())).not.toContain("gsk-secret");
    });
  });
});

describe("given an environment holding a secret key set to an empty string", () => {
  describe("when the chain resolves it", () => {
    /** @scenario "A blank value counts as absent" */
    it("answers for no key", async () => {
      const chain = ChainedSecretSource.create({
        sources: [EnvSecretSource.create({ environment: { OPENAI_API_KEY: "   " } })],
      });

      expect(await chain.resolve({ keys: ["OPENAI_API_KEY"] })).toEqual(new Map());
    });
  });
});

describe("given a required key no source can answer for", () => {
  describe("when the chain resolves it", () => {
    /** @scenario "Refusal names every missing required key" */
    it("refuses boot with the key named and no candidate value", async () => {
      const chain = ChainedSecretSource.create({
        sources: [
          EnvSecretSource.create({ environment: {} }),
          RefusingSecretSource.create({
            required: ["LW_GATEWAY_JWT_SECRET"],
            triedSources: ["env"],
          }),
        ],
      });

      await expect(chain.resolve({ keys: ["LW_GATEWAY_JWT_SECRET"] })).rejects.toThrow(
        MissingSecretsError,
      );
      await expect(chain.resolve({ keys: ["LW_GATEWAY_JWT_SECRET"] })).rejects.toThrow(
        /LW_GATEWAY_JWT_SECRET/,
      );
    });
  });
});
