/**
 * The lookup order the app states on the Server preamble. An order, never a
 * store: nothing pre-fetched or held — each fetch walks the adapters front to
 * back for ONE id, or one declared family's prefix, and forgets its answer.
 */
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { OnePasswordInProductionError, OnePasswordUnavailableError } from "./secrets.errors.ts";

/** One place a single id can be read from, one key at a time, or scanned by one prefix. */
type SecretAdapter = Readonly<{
  describe: string;
  read(id: string): Promise<string | undefined>;
  scan(prefix: string): Promise<ReadonlyMap<string, string>>;
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
      scan: (prefix) => Promise.resolve(presentUnder(prefix, Object.entries(this.environment))),
    });
  }

  /** The workspace `.env` file, scanned per key, never held. */
  withFile(file: string = path.join(process.cwd(), ".env")): SecretsChain {
    return this.with({
      describe: `file:${file}`,
      read: (id) => readDotenvKey(file, id),
      scan: (prefix) => scanDotenvPrefix(file, prefix),
    });
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
      // A vault item is not enumerated: a family answers from the environment only.
      scan: () => Promise.resolve(new Map()),
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

  /** Every name under one prefix, front to back; per name the first answer wins. */
  async fetchFamily(prefix: string): Promise<ReadonlyMap<string, string>> {
    const answers = new Map<string, string>();

    for (const adapter of this.adapters) {
      for (const [name, value] of await adapter.scan(prefix)) {
        if (!answers.has(name)) answers.set(name, value);
      }
    }

    return answers;
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
  for (const [name, value] of await readDotenvLines(file)) {
    if (name === id) return presentOrAbsent(value);
  }

  return undefined;
}

/** The dotenv lines whose name starts with `prefix`; the first line for a name wins. */
async function scanDotenvPrefix(
  file: string,
  prefix: string,
): Promise<ReadonlyMap<string, string>> {
  const found = new Map<string, string>();

  for (const [name, value] of presentUnder(prefix, await readDotenvLines(file))) {
    if (!found.has(name)) found.set(name, value);
  }

  return found;
}

async function readDotenvLines(file: string): Promise<[string, string][]> {
  let content: string;

  try {
    content = await fs.promises.readFile(file, "utf8");
  } catch {
    // No file is an ordinary absence: the next adapter answers.
    return [];
  }

  return content.split("\n").flatMap((line): [string, string][] => {
    const bare = line.trim();
    const equals = bare.indexOf("=");

    if (bare.startsWith("#") || equals <= 0) return [];

    return [[bare.slice(0, equals), unquote(bare.slice(equals + 1).trim())]];
  });
}

/** The set, non-empty entries whose name starts with `prefix`; an empty prefix names none. */
function presentUnder(
  prefix: string,
  entries: Iterable<readonly [string, string | undefined]>,
): Map<string, string> {
  const found = new Map<string, string>();

  if (prefix === "") return found;

  for (const [name, value] of entries) {
    const present = presentOrAbsent(value);

    if (name.startsWith(prefix) && present !== undefined && !found.has(name)) {
      found.set(name, present);
    }
  }

  return found;
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
