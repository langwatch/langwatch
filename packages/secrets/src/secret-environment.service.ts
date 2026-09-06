import { ChainedSecretSource, type SecretAttribution } from "./chained.secret-source.ts";
import { DevGeneratedSecretSource } from "./dev-generated.secret-source.ts";
import { EnvSecretSource } from "./env.secret-source.ts";
import { classOf, SECRET_REGISTRY } from "./keys.ts";
import { NodeProcessRunner } from "./node-process-runner.adapter.ts";
import { vaultItemFrom } from "./one-password-item.ts";
import { OnePasswordSecretSource } from "./one-password.secret-source.ts";
import type { ProcessRunnerPort } from "./process-runner.port.ts";
import { RefusingSecretSource } from "./refusing.secret-source.ts";
import type { SecretSource } from "./secret-source.port.ts";

/** What one boot resolved, and who answered. Values are in the record only. */
export type SecretResolution = Readonly<{
  environment: Readonly<Record<string, unknown>>;
  attribution: readonly SecretAttribution[];
}>;

/**
 * Resolves every classified key through an ordered chain before the runtime's
 * Zod parse, so every feature downstream still sees a plain string.
 *
 * The record it returns is a new frozen object; `process.env` is not mutated,
 * so a stray `process.env.OPENAI_API_KEY` read stays exactly as broken as the
 * `secrets-through-source` lint rule says it is.
 */
export class SecretEnvironmentService {
  static create({
    source,
    runner,
  }: {
    source: Readonly<Record<string, unknown>>;
    runner?: ProcessRunnerPort;
  }): SecretEnvironmentService {
    return new SecretEnvironmentService(source, runner);
  }

  private constructor(
    private readonly source: Readonly<Record<string, unknown>>,
    private readonly runner: ProcessRunnerPort | undefined,
  ) {}

  async resolve(): Promise<SecretResolution> {
    const chain = this.chain();
    const keys = SECRET_REGISTRY.keys
      .filter((entry) => entry.class !== "pointer")
      .map(({ key }) => key);
    const resolved = await chain.resolve({ keys });

    return {
      attribution: chain.attribution().filter(({ key }) => classOf({ key }) === "secret"),
      environment: Object.freeze({ ...this.source, ...Object.fromEntries(resolved) }),
    };
  }

  /**
   * Development gets shell env, .env, and 1Password when a vault is named;
   * production gets the pod environment and nothing else, so it never shells
   * out, holds no vault session, and gains no failure mode.
   */
  private chain(): ChainedSecretSource {
    const sources: SecretSource[] = [EnvSecretSource.create({ environment: this.source })];
    const item =
      this.source.NODE_ENV === "production" ? void 0 : vaultItemFrom({ environment: this.source });
    if (this.usesVault()) {
      const runner = this.runner ?? NodeProcessRunner.create();
      sources.push(OnePasswordSecretSource.create({ environment: this.source, runner }));
      // Opt-in, because it writes: a first launch mints the four values the
      // ensure scripts would have put in `.env` and puts them in the vault.
      if (item !== undefined && optedIn(this.source.LANGWATCH_SECRETS_GENERATE)) {
        sources.push(DevGeneratedSecretSource.create({ item, runner }));
      }
    }
    const required = SECRET_REGISTRY.keys
      .filter((entry) => entry.dev === "required")
      .map(({ key }) => key);
    sources.push(
      RefusingSecretSource.create({ required, triedSources: sources.map(({ name }) => name) }),
    );

    return ChainedSecretSource.create({ sources });
  }

  private usesVault(): boolean {
    if (this.source.NODE_ENV === "production") return false;
    const vault = this.source.LANGWATCH_SECRETS_VAULT;
    const referenced = SECRET_REGISTRY.keys.some((entry) => {
      const value = this.source[entry.key];
      return typeof value === "string" && value.trim().startsWith("op://");
    });

    return (typeof vault === "string" && vault.trim() !== "") || referenced;
  }
}

/** `1`, `true` or `yes` — the developer asked for values to be written. */
function optedIn(value: unknown): boolean {
  return typeof value === "string" && ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

/**
 * The one boot line: which source answered which SECRET key, by name. Empty
 * when nothing classified was present, which is the honest report for a
 * checkout that has not been configured yet.
 */
export function secretResolutionSummary({
  attribution,
}: {
  attribution: readonly SecretAttribution[];
}): string {
  if (attribution.length === 0) return "no classified secret was resolved";

  return attribution.map(({ key, source }) => `${key}=<${source}>`).join(" ");
}
