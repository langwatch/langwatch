/**
 * The lookup order the app states on the Server preamble. An order, never a
 * store: nothing pre-fetched, held or enumerated — each fetch walks the
 * adapters front to back for ONE id and forgets the answer it hands over.
 */
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { OnePasswordInProductionError, OnePasswordUnavailableError } from "./secrets.errors.ts";

/** One place a single id can be read from, one key at a time. */
type SecretAdapter = Readonly<{
  describe: string;
  read(id: string): Promise<string | undefined>;
}>;

export class SecretsChain {
  /** The Server starts the chain at the one boot seam and hands it in. */
  static start(options: {
    environment: Readonly<Record<string, string | undefined>>;
  }): SecretsChain {
    return new SecretsChain(options.environment, []);
  }

  private constructor(
    private readonly environment: Readonly<Record<string, string | undefined>>,
    private readonly adapters: readonly SecretAdapter[],
  ) {}

  /** The process environment, as the boot seam supplied it. */
  withEnv(): SecretsChain {
    return this.with({
      describe: "env",
      read: (id) => Promise.resolve(presentOrAbsent(this.environment[id])),
    });
  }

  /** The workspace `.env` file, scanned per key, never held. */
  withFile(file: string = path.join(process.cwd(), ".env")): SecretsChain {
    return this.with({ describe: `file:${file}`, read: (id) => readDotenvKey(file, id) });
  }

  /**
   * 1Password: one account key plus convention — your private vault, the
   * LangWatch item, the handle's own id as the field. No account, inert
   * word. A development convenience only: production refuses it by name.
   */
  withOnePassword(account: string | undefined): SecretsChain {
    const chosen = account?.trim();

    if (chosen === undefined || chosen === "") return this;

    if (this.environment["NODE_ENV"] === "production") {
      throw new OnePasswordInProductionError();
    }

    return this.with({
      describe: `1password:${chosen}`,
      read: (id) => readOnePasswordField({ account: chosen, id }),
    });
  }

  /** One id, front to back, first answer wins. Internal to the resolver. */
  async fetch(id: string): Promise<string | undefined> {
    for (const adapter of this.adapters) {
      const value = await adapter.read(id);

      if (value !== undefined) return value;
    }

    return undefined;
  }

  private with(adapter: SecretAdapter): SecretsChain {
    return new SecretsChain(this.environment, [...this.adapters, adapter]);
  }
}

const ONE_PASSWORD_VAULT = "Private";
const ONE_PASSWORD_ITEM = "LangWatch";

/** `op read op://Private/LangWatch/<id>`: a missing key is an ordinary miss. */
async function readOnePasswordField(options: {
  account: string;
  id: string;
}): Promise<string | undefined> {
  const reference = `op://${ONE_PASSWORD_VAULT}/${ONE_PASSWORD_ITEM}/${options.id}`;
  const result = await run("op", ["read", reference, "--account", options.account, "--no-newline"]);

  if (result.code === 0) return presentOrAbsent(result.stdout);

  if (/isn't an item|not found|no item matched|isn't a field/i.test(result.stderr)) {
    return undefined;
  }

  throw new OnePasswordUnavailableError(result.stderr.split("\n")[0] || `op exited ${result.code}`);
}

function run(
  command: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

/** Reads one KEY=VALUE line from a dotenv file without holding the file. */
async function readDotenvKey(file: string, id: string): Promise<string | undefined> {
  let content: string;

  try {
    content = await fs.promises.readFile(file, "utf8");
  } catch {
    // No file is an ordinary absence: the next adapter answers.
    return undefined;
  }

  for (const line of content.split("\n")) {
    const bare = line.trim();

    if (bare.startsWith("#") || !bare.startsWith(`${id}=`)) continue;

    return presentOrAbsent(unquote(bare.slice(id.length + 1).trim()));
  }

  return undefined;
}

function unquote(value: string): string {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));

  return quoted && value.length >= 2 ? value.slice(1, -1) : value;
}

function presentOrAbsent(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}
