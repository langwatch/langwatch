import { classOf } from "./keys.ts";
import { referenceFor, writeFields, type VaultItem } from "./one-password-item.ts";
import type { ProcessRunner } from "./process-runner.port.ts";

/** What a migration did, by key name. No value is ever carried out of here. */
export type SecretMigrationReport = Readonly<{
  moved: readonly string[];
  alreadyReferences: readonly string[];
  envFile: string;
}>;

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** Strips one layer of matching quotes, the way every dotenv reader does. */
function statedValue(raw: string): string {
  const trimmed = raw.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);

  return (quoted?.[2] ?? trimmed).trim();
}

/** Moves .env credentials to 1Password profile item and rewrites lines to
 * `op://` references. Returns replacement text; caller owns the disk write. */
export class SecretMigrationService {
  static create({
    item,
    runner,
  }: {
    item: VaultItem;
    runner: ProcessRunner;
  }): SecretMigrationService {
    return new SecretMigrationService(item, runner);
  }

  private constructor(
    private readonly item: VaultItem,
    private readonly runner: ProcessRunner,
  ) {}

  async push({
    envFile,
    rewrite = true,
  }: {
    envFile: string;
    rewrite?: boolean;
  }): Promise<SecretMigrationReport> {
    const lines = envFile.split("\n");
    const values = new Map<string, string>();
    const alreadyReferences: string[] = [];

    for (const line of lines) {
      const match = ASSIGNMENT.exec(line);
      if (!match) continue;
      const key = match[1] ?? "";
      if (classOf({ key }) !== "secret") continue;
      const value = statedValue(match[2] ?? "");
      if (value === "") continue;
      if (value.startsWith("op://")) {
        alreadyReferences.push(key);
        continue;
      }
      values.set(key, value);
    }

    await writeFields({ fields: values, item: this.item, runner: this.runner });

    return {
      alreadyReferences,
      envFile: rewrite ? this.rewritten(lines, values) : envFile,
      moved: [...values.keys()],
    };
  }

  private rewritten(lines: readonly string[], moved: ReadonlyMap<string, string>): string {
    return lines
      .map((line) => {
        const match = ASSIGNMENT.exec(line);
        const key = match?.[1] ?? "";
        if (!match || !moved.has(key)) return line;

        return `${key}=${referenceFor({ item: this.item, key })}`;
      })
      .join("\n");
  }
}
