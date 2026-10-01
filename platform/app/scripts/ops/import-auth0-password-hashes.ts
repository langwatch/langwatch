/**
 * One-time import of Auth0's password-hash export for the database-connection
 * (email+password, `auth0|...`) cohort — ADR-143.
 *
 * Every write goes through `CredentialAccountService.importPasswordHash`, the
 * same gate-aware records the app's own `setFirstPassword` writes through. For
 * a user the identity backfill has finalized ("latched"), that states the
 * `credential` identifier as an identity event and stores the hash in
 * `AccountCredential`, mirrored onto the `Account` bridge row; sign-in reads
 * those, never `Account`, so a raw `Account` write would be invisible to it.
 * For a user not yet latched it writes the legacy `Account` row, which the
 * backfill adopts when it finalizes them. Hashes never enter
 * an event, so replaying the identity log cannot lose one.
 *
 * Only bcrypt hashes import: sign-in verifies with `bcrypt.compare`. Anything
 * else (a `custom_password_hash` of another algorithm) is counted and listed
 * by Auth0 user id, and stays on the live Auth0 fallback. Each record is
 * matched by its Auth0 `user_id`, never by email.
 *
 * DRY-RUN BY DEFAULT: plans every record, reading Postgres only, and writes
 * nothing. APPLY=1 writes.
 * An APPLY run boots the app's event-sourcing stack in the one-shot
 * `migration` role (as the system-migrations task does): it folds only the
 * identity events it staged itself, on an isolated dispatch allow-list, and
 * waits for them to drain before exiting. It therefore needs the target's
 * CLICKHOUSE_URL, BASE_HOST, ENVIRONMENT and exactly one of REDIS_URL and
 * REDIS_CLUSTER_ENDPOINTS beside DATABASE_URL, all pointing at the SAME
 * deployment, and refuses to start without them. It asks for "yes" before
 * writing, after showing every target.
 *
 * Nothing here loads `.env`: the shell is the whole environment, and the app's
 * own env validation is skipped (skip-app-env-validation.ts) in favour of the
 * check below. Never prints a hash or an email, nor an error's message (a
 * Prisma or JSON error quotes its input): errors print as name and code.
 * Auth0 user ids appear so skips can be followed up. After an APPLY drains, every written user is read back
 * through the same path sign-in uses, and one that does not read back as
 * holding a password is listed and fails the run.
 *
 * Every record is resolved to its local user before anything is written,
 * and the whole plan prints before the "yes" prompt. A person who appears
 * more than once is not imported at all: for a latched user two writes
 * attach two credential identifiers, the second before the first folds,
 * and that collides on Account's unique key and blocks every later account
 * write for them. Which of the hashes is current cannot be told from the
 * file, so they stay on the live Auth0 fallback and are listed.
 *
 * Reruns are safe too. Before an APPLY writes a user it appends their user
 * id to a ledger beside the export (`<export>.applied`), and every run skips
 * a user already in it, for the same reason: a latched user who errored may
 * already have an attach staged. Error and skip lines say "(latched)" where
 * it applies. Retrying an errored user is a decision: check them, then
 * delete their line from the ledger. A latched write that outlasts the
 * writer's wait for the fold reports as an error; if it reads back after
 * the drain it is listed as landed, and needs nothing.
 *
 * $2y$ hashes (PHP's name for the same bcrypt) are stored as $2b$: the
 * bcrypt library sign-in uses refuses the $2y$ prefix.
 *
 * Usage, from platform/app:
 *   AUTH0_EXPORT_PATH=/path/to/export.json DATABASE_URL=<url> \
 *     pnpm tsx scripts/ops/import-auth0-password-hashes.ts
 *   AUTH0_EXPORT_PATH=... DATABASE_URL=... REDIS_URL=... CLICKHOUSE_URL=... \
 *     BASE_HOST=... ENVIRONMENT=<the target's> APPLY=1 \
 *     pnpm tsx scripts/ops/import-auth0-password-hashes.ts
 *
 * Accepts a JSON array or newline-delimited JSON, in either Auth0 shape: the
 * support-issued password-hash export (`_id: {"$oid"}`, `passwordHash`, the
 * user id being `auth0|<oid>`) or the bulk-import schema (`user_id`,
 * `password_hash`, `custom_password_hash`). Neither was checked against the
 * real file: read the dry-run summary first, where a mismatch shows up as
 * every record skipped rather than as a write.
 */
import "./skip-app-env-validation";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { setEnvironment } from "@langwatch/ksuid";
import { getApp, tryGetApp } from "~/server/app-layer/app";
import type { PasswordImportOutcome } from "~/server/app-layer/identity/credential-account.service";
import {
  credentialAccounts,
  isLatched,
} from "~/server/app-layer/identity/runtime";
import { initializeMigrationApp } from "~/server/app-layer/presets";
import { assertRedisReady } from "~/server/app-layer/redis-readiness";
import { prisma } from "~/server/db";
import {
  type Auth0ExportRecord,
  auth0UserIdOf,
  bcryptHashOf,
  describeErrorSafely,
  ImportStoppedError,
  parseExport,
} from "./auth0-password-export";

const APPLY = process.env.APPLY === "1";

const REQUIRED = APPLY
  ? ["AUTH0_EXPORT_PATH", "DATABASE_URL", "CLICKHOUSE_URL", "BASE_HOST", "ENVIRONMENT"]
  : ["AUTH0_EXPORT_PATH", "DATABASE_URL"];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `ERROR: ${missing.join(", ")} not set. Nothing was read or written.`,
  );
  process.exit(1);
}
// The app connects to REDIS_CLUSTER_ENDPOINTS when it is set, whatever
// REDIS_URL says, so exactly one may be set or the target shown is a guess.
if (APPLY && !process.env.REDIS_URL === !process.env.REDIS_CLUSTER_ENDPOINTS) {
  console.error(
    "ERROR: set exactly one of REDIS_URL and REDIS_CLUSTER_ENDPOINTS, the one the target deployment uses. Nothing was read or written.",
  );
  process.exit(1);
}

/** Where a URL points, without its credentials. */
function hostOf(url: string | undefined): string {
  try {
    const parsed = new URL(url ?? "");
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "<invalid url>";
  }
}

/** Cluster endpoints are `host:port` pairs, sometimes with credentials. */
function redisTarget(): string {
  const cluster = process.env.REDIS_CLUSTER_ENDPOINTS;
  if (!cluster) return hostOf(process.env.REDIS_URL);
  const hosts = cluster
    .split(",")
    .map((endpoint) => endpoint.trim().replace(/^.*@/, ""));
  return `cluster ${hosts.join(", ")}`;
}

/** User ids an earlier APPLY began writing; see the header on reruns. */
const LEDGER_PATH = `${process.env.AUTH0_EXPORT_PATH}.applied`;

function readLedger(): Set<string> {
  if (!existsSync(LEDGER_PATH)) return new Set();
  return new Set(
    readFileSync(LEDGER_PATH, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

async function confirmApply(): Promise<void> {
  console.log("\nAbout to WRITE credentials into:");
  console.log(`  postgres:    ${hostOf(process.env.DATABASE_URL)}`);
  console.log(`  redis:       ${redisTarget()}`);
  console.log(`  clickhouse:  ${hostOf(process.env.CLICKHOUSE_URL)}`);
  console.log(`  environment: ${process.env.ENVIRONMENT}`);
  console.log(`  ledger:      ${LEDGER_PATH}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "yes" to continue: ');
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    throw new ImportStoppedError("Aborted. Nothing was written.");
  }
}

/** Boots the event stack the identity writes append through. */
async function bootEventStack(): Promise<() => Promise<void>> {
  setEnvironment(process.env.ENVIRONMENT ?? "local");
  initializeMigrationApp();
  await assertRedisReady();
  const queue = getApp().eventSourcing?.globalQueue;
  const waitUntilIdle = queue?.waitUntilPreflightIdle;
  if (!queue || !waitUntilIdle) {
    throw new ImportStoppedError(
      "The migration queue exposes no completion barrier.",
    );
  }
  return () => waitUntilIdle.call(queue);
}

type Listed =
  | "non_bcrypt"
  | "no_account"
  | "duplicate"
  | "in_ledger"
  | "errored"
  | "landed_late"
  | "not_visible";
type Counted =
  | Listed
  | PasswordImportOutcome
  | "no_user_id"
  | "not_database_connection"
  | "via_identity_events"
  | "via_legacy_row"
  | "verified";

interface Tally {
  count(key: Counted): void;
  skip(key: Listed, line: string): void;
  n(key: Counted): number;
  listed: Record<Listed, string[]>;
}

function newTally(): Tally {
  const counts = new Map<Counted, number>();
  const listed: Record<Listed, string[]> = {
    non_bcrypt: [],
    no_account: [],
    duplicate: [],
    in_ledger: [],
    errored: [],
    landed_late: [],
    not_visible: [],
  };
  const count = (key: Counted) => counts.set(key, (counts.get(key) ?? 0) + 1);
  return {
    count,
    skip: (key, line) => {
      count(key);
      listed[key].push(line);
    },
    n: (key) => counts.get(key) ?? 0,
    listed,
  };
}

type Credentials = ReturnType<typeof credentialAccounts>;

/** One export record resolved to the local user it names, read-only. */
interface Candidate {
  auth0UserId: string;
  userId: string;
  hash: string;
  latched: boolean;
}

const latchNote = (latched: boolean) => (latched ? " (latched)" : "");

/**
 * Resolves every record before anything is written, so the whole plan,
 * duplicates included, is known before the "yes" prompt. Reads only.
 */
async function resolveRecords({
  records,
  credentials,
  tally,
}: {
  records: Auth0ExportRecord[];
  credentials: Credentials;
  tally: Tally;
}): Promise<Candidate[]> {
  const resolved: Candidate[] = [];
  for (const record of records) {
    const auth0UserId = auth0UserIdOf(record);
    if (!auth0UserId) {
      tally.count("no_user_id");
      continue;
    }
    // A social or enterprise identity has no password to import.
    if (!auth0UserId.startsWith("auth0|")) {
      tally.count("not_database_connection");
      continue;
    }
    const hash = bcryptHashOf(record);
    if (!hash) {
      tally.skip("non_bcrypt", auth0UserId);
      continue;
    }
    const userId = await credentials.findUserIdForFederatedPasswordAccount({
      federatedUserId: auth0UserId,
    });
    if (!userId) {
      tally.skip("no_account", auth0UserId);
      continue;
    }
    const latched = await isLatched({ userId });
    resolved.push({ auth0UserId, userId, hash, latched });
  }

  // Two records for one person cannot both be written: for a latched user
  // the second attach lands before the first folds and collides on the
  // Account unique key, blocking every later account write for them. Which
  // hash is current cannot be told from the file, so neither is imported.
  const perUser = new Map<string, number>();
  for (const { userId } of resolved) {
    perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
  }
  return resolved.filter((candidate) => {
    if ((perUser.get(candidate.userId) ?? 0) < 2) return true;
    tally.skip(
      "duplicate",
      `${candidate.auth0UserId}${latchNote(candidate.latched)}`,
    );
    return false;
  });
}

async function writeCandidate({
  candidate: { auth0UserId, userId, hash, latched },
  credentials,
  ledger,
  tally,
  written,
}: {
  candidate: Candidate;
  credentials: Credentials;
  ledger: Set<string>;
  tally: Tally;
  written: Candidate[];
}): Promise<void> {
  const note = latchNote(latched);
  if (ledger.has(userId)) return tally.skip("in_ledger", auth0UserId + note);
  try {
    const planned = await credentials.planPasswordImport({ userId });
    if (APPLY && planned !== "already_has_password") {
      // Ledgered BEFORE the write: a write that throws may still have staged
      // an attach, and that is exactly the user a rerun must not touch again.
      appendFileSync(LEDGER_PATH, `${userId}\n`, { mode: 0o600 });
      written.push({ auth0UserId, userId, hash, latched });
    }
    const outcome: PasswordImportOutcome =
      APPLY && planned !== "already_has_password"
        ? await credentials.importPasswordHash({ userId, passwordHash: hash })
        : planned;
    tally.count(outcome);
    if (outcome !== "already_has_password") {
      tally.count(latched ? "via_identity_events" : "via_legacy_row");
    }
    console.log(`  [${APPLY ? "OK " : "DRY"}] ${auth0UserId} -> ${outcome}${note}`);
  } catch (error) {
    tally.skip("errored", auth0UserId + note);
    console.error(
      `  [ERR] ${auth0UserId}${note} -> ${describeErrorSafely(error)}`,
    );
  }
}

/**
 * Reads every write back the way sign-in will, after the events folded. A
 * latched write can outlast the writer's read-your-writes wait and be
 * reported as an error although its attach was staged; if it reads back
 * now, it landed, and moves from errored to done.
 */
async function verifyWrites({
  credentials,
  tally,
  written,
}: {
  credentials: Credentials;
  tally: Tally;
  written: Candidate[];
}): Promise<void> {
  for (const { auth0UserId, userId, latched } of written) {
    const line = auth0UserId + latchNote(latched);
    let readable = false;
    try {
      readable =
        (await credentials.planPasswordImport({ userId })) ===
        "already_has_password";
    } catch (error) {
      console.error(`  [ERR] read-back ${line} -> ${describeErrorSafely(error)}`);
    }
    const erroredAt = tally.listed.errored.indexOf(line);
    if (readable && erroredAt >= 0) {
      tally.listed.errored.splice(erroredAt, 1);
      tally.skip("landed_late", line);
    } else if (readable) {
      tally.count("verified");
    } else if (erroredAt < 0) {
      tally.skip("not_visible", line);
    }
  }
}

function printSummary({ total, tally }: { total: number; tally: Tally }) {
  const { n, listed } = tally;
  const verb = APPLY ? "" : "would ";
  console.log("\nSummary:");
  const row = (label: string, value: number) =>
    console.log(`  ${label.padEnd(36)} ${value}`);
  row("records in file:", total);
  row("skipped, no user_id:", n("no_user_id"));
  row("skipped, not auth0| (no password):", n("not_database_connection"));
  row("skipped, not bcrypt:", n("non_bcrypt"));
  row("skipped, no matching account:", n("no_account"));
  row("skipped, same person twice:", n("duplicate"));
  row("skipped, already a password:", n("already_has_password"));
  row("skipped, in ledger (earlier run):", n("in_ledger"));
  row(`${verb}create a credential:`, n("creates_credential"));
  row(`${verb}fill a passkey placeholder:`, n("fills_placeholder"));
  row("  of which latched (events):", n("via_identity_events"));
  row("  of which legacy (backfill):", n("via_legacy_row"));
  row("errored:", listed.errored.length);
  if (APPLY) {
    row("read back with a password:", n("verified"));
    row("errored, but landed after the wait:", n("landed_late"));
    row("NOT readable yet:", n("not_visible"));
  }

  for (const [label, ids] of [
    ["Not bcrypt, still on live Auth0", listed.non_bcrypt],
    ["No matching account here", listed.no_account],
    ["Same person more than once in the export, none imported", listed.duplicate],
    [
      "Already attempted by an earlier APPLY (see the ledger to retry)",
      listed.in_ledger,
    ],
    [
      "Errored, needs a look (ledgered: a rerun skips them)",
      listed.errored,
    ],
    ["Errored but landed after the wait (done)", listed.landed_late],
    [
      "Written but not readable yet (wait for the fold, then check)",
      listed.not_visible,
    ],
  ] as const) {
    if (ids.length === 0) continue;
    console.log(`\n${label} (auth0 user ids):`);
    for (const id of ids) console.log(`  ${id}`);
  }
}

async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN (writes nothing)"}\n`);

  const records = parseExport(
    readFileSync(process.env.AUTH0_EXPORT_PATH ?? "", "utf8"),
  );
  console.log(`Export file: ${records.length} record(s)`);

  const credentials = credentialAccounts();
  const tally = newTally();
  const candidates = await resolveRecords({ records, credentials, tally });

  let drain: (() => Promise<void>) | null = null;
  if (APPLY) {
    await confirmApply();
    drain = await bootEventStack();
  }

  // From the first write on, the summary is what says who is safe to rerun,
  // so it prints whatever happens after this point.
  const ledger = readLedger();
  const written: Candidate[] = [];
  let drainFailure: string | null = null;
  try {
    for (const candidate of candidates) {
      await writeCandidate({ candidate, credentials, ledger, tally, written });
    }
    if (drain) {
      console.log("\nWaiting for the staged identity events to fold...");
      await drain().catch((error: unknown) => {
        // The queue's own failure: identity events carry no hash.
        drainFailure = error instanceof Error ? error.message : String(error);
      });
      await verifyWrites({ credentials, tally, written });
    }
  } finally {
    printSummary({ total: records.length, tally });
  }

  if (drainFailure) console.error(`\nDraining failed: ${drainFailure}`);
  const failed = tally.listed.errored.length + tally.n("not_visible") > 0;
  if (failed || drainFailure) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    // Per-record failures are caught in writeCandidate, and parseExport never
    // quotes its input; anything else prints as name and code only.
    console.error(`ERROR: ${describeErrorSafely(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await tryGetApp()?.close();
    await prisma.$disconnect();
    process.exit();
  });
