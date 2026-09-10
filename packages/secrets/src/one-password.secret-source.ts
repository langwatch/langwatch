import { referenceFor, vaultItemFrom } from "./one-password-item.ts";
import type { ProcessRunner } from "./process-runner.port.ts";
import { SecretSource } from "./secret-source.port.ts";

/** A 1Password secret reference: `op://<vault>/<item>/<field>`. */
const REFERENCE = /^op:\/\/[^/\s]+\/[^/\s]+\/[^\s]+$/;

/** `op` answered, but the session is not usable. Needs different words than a miss. */
export class OnePasswordUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `1Password could not be read: ${detail}. Run \`op signin\` (or unlock the desktop app) and retry.`,
    );
    this.name = "OnePasswordUnavailableError";
  }
}

/**
 * Resolves secrets through the `op` CLI, in two modes.
 *
 * Reference mode: the value already in the environment is itself an
 * `op://vault/item/field` reference, and this source replaces it with what it
 * points at. The developer's `.env` stays the index of what exists.
 *
 * Profile mode: a key with no value at all is looked up at
 * `op://<LANGWATCH_SECRETS_VAULT>/langwatch-<LANGWATCH_SECRETS_PROFILE>/<KEY>`,
 * off entirely unless the vault is set. Keyed on an explicit profile rather
 * than the worktree name: a directory rename must not silently turn a secret
 * into an absent one.
 *
 * The CLI rather than the SDK: the SDK needs a service-account token, itself a
 * long-lived secret to store on a laptop, and cannot use biometric unlock.
 */
export class OnePasswordSecretSource extends SecretSource {
  static create({
    runner,
    environment,
    name = "1password",
  }: {
    runner: ProcessRunner;
    environment: Readonly<Record<string, unknown>>;
    name?: string;
  }): OnePasswordSecretSource {
    return new OnePasswordSecretSource(runner, environment, name);
  }

  private constructor(
    private readonly runner: ProcessRunner,
    private readonly environment: Readonly<Record<string, unknown>>,
    readonly name: string,
  ) {
    super();
  }

  async resolve({ keys }: { keys: readonly string[] }): Promise<Map<string, string>> {
    const wanted = new Map<string, string>();
    for (const key of keys) {
      const reference = this.referenceFor(key);
      if (reference !== undefined) wanted.set(key, reference);
    }
    if (wanted.size === 0) return new Map<string, string>();

    return this.read(wanted);
  }

  /**
   * One `op inject` for the whole batch: a template of `KEY=<reference>` lines
   * comes back with each reference replaced, so a boot costs one subprocess
   * rather than one per variable.
   */
  private async read(wanted: ReadonlyMap<string, string>): Promise<Map<string, string>> {
    const order = [...wanted.keys()];
    const template = order.map((key) => `${key}=${wanted.get(key) ?? ""}`).join("\n");
    const result = await this.runner.run({
      command: "op",
      args: ["inject"],
      input: template,
    });
    if (result.code !== 0) {
      if (isMissingItem(result.stderr)) return new Map<string, string>();
      throw new OnePasswordUnavailableError(firstLine(result.stderr) || `op exited ${result.code}`);
    }

    const found = new Map<string, string>();
    for (const line of result.stdout.split("\n")) {
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1).trim();
      if (!wanted.has(key) || value === "" || REFERENCE.test(value)) continue;
      found.set(key, value);
    }

    return found;
  }

  /** The reference this source would resolve for one key, or nothing. */
  private referenceFor(key: string): string | undefined {
    const stated = this.environment[key];
    if (typeof stated === "string" && REFERENCE.test(stated.trim())) return stated.trim();
    if (typeof stated === "string" && stated.trim() !== "") return void 0;

    const item = vaultItemFrom({ environment: this.environment });

    return item === undefined ? void 0 : referenceFor({ item, key });
  }
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

/**
 * A vault or item that does not exist is a miss, not a failure: the chain
 * carries on to the next source. Being signed out is the opposite.
 */
function isMissingItem(stderr: string): boolean {
  return /isn't an item|not found|no item matched/i.test(stderr);
}
