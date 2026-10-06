import { createLogger } from "@langwatch/observability";
import { aesEncryption } from "@langwatch/process-stores";
import type { ScopedSecrets, SecretHandle } from "@langwatch/secrets";
import { Task } from "@langwatch/task";

import type {
  CredentialsResealRepository,
  SealedCandidate,
  SealedColumn,
  SealedReplacement,
} from "../repositories/credentials-reseal.repository.ts";
import { resealText, type CredentialCipher } from "../rules/credentials-reseal.rules.ts";

const logger = createLogger("langwatch:task:credentials-reseal");

/** Row keys named per column when a value opens under neither key; the count is always whole. */
const UNDECRYPTABLE_KEYS_LOGGED = 20;

/** One cipher per key, never the rotating one: the task has to know which key opened a value. */
type CredentialsResealCiphers = Readonly<{
  current: CredentialCipher | undefined;
  previous: CredentialCipher | undefined;
}>;

type CredentialsResealOptions = Readonly<{
  repository: CredentialsResealRepository;
  ciphers: CredentialsResealCiphers;
  /** Counts what would be re-sealed and writes nothing. */
  dryRun?: boolean;
  batchSize?: number;
  signal?: AbortSignal;
}>;

type CredentialsResealColumnReport = Readonly<{
  table: string;
  column: string;
  /** Sealed under the previous key and moved to the current one (or, in a dry run, due to be). */
  resealed: number;
  alreadyCurrent: number;
  /** Opened by neither key, and left as found. */
  undecryptable: number;
  /** Rows another writer changed between the read and the write; the next run covers them. */
  changedMeanwhile: number;
}>;

export type CredentialsResealReport = Readonly<{
  mode: "dry-run" | "apply";
  previousKeyConfigured: boolean;
  columns: readonly CredentialsResealColumnReport[];
  /** Columns of tables with no primary key, which cannot be walked. */
  skipped: readonly { table: string; column: string }[];
  totals: Readonly<{ resealed: number; alreadyCurrent: number; undecryptable: number }>;
}>;

/**
 * Moves every stored value sealed under the previous CREDENTIALS_SECRET to the
 * current one. Safe to run again: a value the current key opens is never rewritten.
 * A value neither key opens is counted and left alone, and is not a failure.
 */
export async function resealCredentials({
  repository,
  ciphers,
  dryRun = false,
  batchSize = 200,
  signal,
}: CredentialsResealOptions): Promise<CredentialsResealReport> {
  const { current, previous } = ciphers;
  if (!current) {
    throw new Error(
      "credentials-reseal needs CREDENTIALS_SECRET (or NEXTAUTH_SECRET) to seal under; nothing was read or written",
    );
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error("batchSize must be a whole number of at least 1; nothing was read or written");
  }
  if (!previous) {
    logger.warn(
      "CREDENTIALS_SECRET_PREVIOUS is not set, so nothing can be re-sealed: this run only reports which values the current secret opens",
    );
  }

  const columns: CredentialsResealColumnReport[] = [];
  const skipped: { table: string; column: string }[] = [];
  for (const column of await repository.findColumns()) {
    if (column.keys.length === 0) {
      skipped.push({ table: column.table, column: column.column });
      continue;
    }
    const report = await resealColumn({
      repository,
      column,
      current,
      previous,
      dryRun,
      batchSize,
      signal,
    });
    if (report.resealed + report.alreadyCurrent + report.undecryptable > 0) columns.push(report);
  }

  const totals = {
    resealed: columns.reduce((sum, column) => sum + column.resealed, 0),
    alreadyCurrent: columns.reduce((sum, column) => sum + column.alreadyCurrent, 0),
    undecryptable: columns.reduce((sum, column) => sum + column.undecryptable, 0),
  };
  const mode = dryRun ? "dry-run" : "apply";
  for (const column of columns) logger.info({ mode, ...column }, "credentials re-seal column");
  if (skipped.length > 0) {
    logger.warn({ skipped }, "columns of tables without a primary key were not walked");
  }
  logger.info(
    { mode, previousKeyConfigured: previous !== undefined, ...totals },
    "credentials re-seal finished. API key and SCIM token hashes are not part of it: each moves to the current secret the next time it is used while CREDENTIALS_SECRET_PREVIOUS is set, and one not used before that secret is removed has to be issued again",
  );

  return { mode, previousKeyConfigured: previous !== undefined, columns, skipped, totals };
}

async function resealColumn({
  repository,
  column,
  current,
  previous,
  dryRun,
  batchSize,
  signal,
}: {
  repository: CredentialsResealRepository;
  column: SealedColumn;
  current: CredentialCipher;
  previous: CredentialCipher | undefined;
  dryRun: boolean;
  batchSize: number;
  signal: AbortSignal | undefined;
}): Promise<CredentialsResealColumnReport> {
  const counts = { resealed: 0, alreadyCurrent: 0, undecryptable: 0, changedMeanwhile: 0 };
  const undecryptableKeys: (readonly string[])[] = [];
  let after: readonly string[] | null = null;
  let exhausted = false;

  while (!exhausted) {
    signal?.throwIfAborted();
    const page = await repository.findCandidates({ column, after, limit: batchSize });
    const moved = resealPage({ page, current, previous });
    counts.resealed += moved.resealed;
    counts.alreadyCurrent += moved.alreadyCurrent;
    counts.undecryptable += moved.undecryptable;
    const room = UNDECRYPTABLE_KEYS_LOGGED - undecryptableKeys.length;
    undecryptableKeys.push(...moved.undecryptableKeys.slice(0, room));

    if (!dryRun && moved.replacements.length > 0) {
      const written = await repository.replaceValues({ column, rows: moved.replacements });
      counts.changedMeanwhile += moved.replacements.length - written;
    }

    exhausted = page.length < batchSize;
    after = page.at(-1)?.key ?? after;
  }

  if (undecryptableKeys.length > 0) {
    logger.warn(
      { table: column.table, column: column.column, rowKeys: undecryptableKeys },
      "values shaped like a sealed value open under neither the current nor the previous secret; they were left as found",
    );
  }
  if (counts.changedMeanwhile > 0) {
    logger.warn(
      { table: column.table, column: column.column, rows: counts.changedMeanwhile },
      "rows changed while they were being re-sealed and were left alone; run the task again",
    );
  }

  return { table: column.table, column: column.column, ...counts };
}

function resealPage({
  page,
  current,
  previous,
}: {
  page: readonly SealedCandidate[];
  current: CredentialCipher;
  previous: CredentialCipher | undefined;
}): {
  resealed: number;
  alreadyCurrent: number;
  undecryptable: number;
  undecryptableKeys: (readonly string[])[];
  replacements: SealedReplacement[];
} {
  const moved = page.map((row) => ({ row, ...resealText({ text: row.value, current, previous }) }));
  return {
    resealed: moved.reduce((sum, each) => sum + each.resealed, 0),
    alreadyCurrent: moved.reduce((sum, each) => sum + each.alreadyCurrent, 0),
    undecryptable: moved.reduce((sum, each) => sum + each.undecryptable, 0),
    undecryptableKeys: moved.filter((each) => each.undecryptable > 0).map((each) => each.row.key),
    replacements: moved
      .filter((each) => each.resealed > 0)
      .map((each) => ({ key: each.row.key, expected: each.row.value, value: each.text })),
  };
}

/** The handles the two ciphers are keyed from, as the module declares them. */
type CredentialsResealSecrets = Readonly<{
  credentials: SecretHandle<string | undefined>;
  credentialsFallback: SecretHandle<string | undefined>;
  credentialsPrevious: SecretHandle<string | undefined>;
}>;

/** Keyed when the task runs: a malformed key refuses the re-seal, never another task's boot. */
type CredentialsResealCipherSource = () => CredentialsResealCiphers;

/** A malformed key refuses under the name of the variable it came from. */
function cipherKeyedBy({ hex, name }: { hex: string; name: string }): CredentialCipher {
  try {
    return aesEncryption(Buffer.from(hex, "hex"));
  } catch (error) {
    throw new Error(
      `${name} is not a usable key. ${error instanceof Error ? error.message : ""} Nothing was read or written.`,
      { cause: error },
    );
  }
}

/**
 * Reads the two keys where the secrets are resolved, so no key leaves the closure.
 * The current key follows the stores: CREDENTIALS_SECRET, else NEXTAUTH_SECRET.
 */
export function credentialsResealCiphers({
  secrets,
  handles,
}: {
  secrets: ScopedSecrets;
  handles: CredentialsResealSecrets;
}): Promise<CredentialsResealCipherSource> {
  return secrets.into(handles.credentials, (credentials) =>
    secrets.into(handles.credentialsFallback, (session) =>
      secrets.into(handles.credentialsPrevious, (previous) => {
        const currentKey = (credentials ?? session)?.trim();
        const currentName = credentials ? "CREDENTIALS_SECRET" : "NEXTAUTH_SECRET";
        const previousKey = previous?.trim();
        return () => ({
          current: currentKey ? cipherKeyedBy({ hex: currentKey, name: currentName }) : undefined,
          previous: previousKey
            ? cipherKeyedBy({ hex: previousKey, name: "CREDENTIALS_SECRET_PREVIOUS" })
            : undefined,
        });
      }),
    ),
  );
}

/**
 * The task-launcher entry: `pnpm --filter @langwatch/tasks task credentials-reseal`,
 * with `--dry-run` to report without writing.
 */
export class CredentialsResealTask extends Task {
  readonly name = "credentials-reseal";
  readonly description =
    "Re-seals stored credentials from CREDENTIALS_SECRET_PREVIOUS to CREDENTIALS_SECRET. Pass --dry-run to report without writing.";

  private constructor(
    private readonly repository: () => CredentialsResealRepository,
    private readonly ciphers: CredentialsResealCipherSource,
  ) {
    super();
  }

  static create({
    repository,
    ciphers,
  }: {
    repository: () => CredentialsResealRepository;
    ciphers: CredentialsResealCipherSource;
  }): CredentialsResealTask {
    return new CredentialsResealTask(repository, ciphers);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const batchSize = args.find((arg) => arg.startsWith("--batch-size="))?.slice(13);
    const unknown = args.filter((arg) => arg !== "--dry-run" && !arg.startsWith("--batch-size="));
    if (unknown.length > 0) {
      throw new Error(
        `credentials-reseal takes --dry-run and --batch-size=<rows>, not ${unknown.join(" ")}; nothing was read or written`,
      );
    }

    await resealCredentials({
      repository: this.repository(),
      ciphers: this.ciphers(),
      dryRun: args.includes("--dry-run"),
      signal,
      ...(batchSize ? { batchSize: Number(batchSize) } : {}),
    });
  }
}
