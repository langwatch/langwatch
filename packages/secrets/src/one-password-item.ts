import type { ProcessRunner } from "./process-runner.port.ts";

/** The 1Password item one profile's secrets live in. */
export type VaultItem = Readonly<{ vault: string; item: string }>;

/** The default item profile, so every worktree resolves to `langwatch-dev`. */
export const DEFAULT_SECRETS_PROFILE = "dev";

function stringSetting(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}

/**
 * The item this environment names, or nothing when no vault is configured.
 * Keyed on an explicit profile rather than the worktree name: a directory
 * rename must not silently turn a secret into an absent one.
 */
export function vaultItemFrom({
  environment,
}: {
  environment: Readonly<Record<string, unknown>>;
}): VaultItem | undefined {
  const vault = stringSetting(environment.LANGWATCH_SECRETS_VAULT);
  if (vault === undefined) return void 0;
  const profile = stringSetting(environment.LANGWATCH_SECRETS_PROFILE) ?? DEFAULT_SECRETS_PROFILE;

  return { item: `langwatch-${profile}`, vault };
}

/** `op://<vault>/<item>/<KEY>`, the reference a `.env` line is rewritten to. */
export function referenceFor({ item, key }: { item: VaultItem; key: string }): string {
  return `op://${item.vault}/${item.item}/${key}`;
}

/**
 * Writes fields into the profile item, creating it the first time.
 *
 * Two commands rather than one because `op` has no upsert: an edit against an
 * item that does not exist yet is a miss, and the create that follows is what
 * a first launch actually does.
 */
export async function writeFields({
  fields,
  item,
  runner,
}: {
  fields: ReadonlyMap<string, string>;
  item: VaultItem;
  runner: ProcessRunner;
}): Promise<void> {
  if (fields.size === 0) return;

  const assignments = [...fields].map(([key, value]) => `${key}[password]=${value}`);
  const edited = await runner.run({
    command: "op",
    args: ["item", "edit", item.item, "--vault", item.vault, ...assignments],
  });
  if (edited.code === 0) return;

  const created = await runner.run({
    command: "op",
    args: [
      "item",
      "create",
      "--category",
      "API Credential",
      "--title",
      item.item,
      "--vault",
      item.vault,
      ...assignments,
    ],
  });
  if (created.code !== 0) {
    throw new Error(
      `1Password refused the write to ${item.vault}/${item.item}: ` +
        (created.stderr.split("\n")[0]?.trim() ?? `op exited ${created.code}`),
    );
  }
}
