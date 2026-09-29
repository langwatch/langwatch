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
 * REDIS_URL, CLICKHOUSE_URL, BASE_HOST and ENVIRONMENT beside DATABASE_URL, all
 * pointing at the SAME deployment, and refuses to start without them. It asks
 * for "yes" before writing.
 *
 * Nothing here loads `.env`: the shell is the whole environment, and the app's
 * own env validation is skipped (skip-app-env-validation.ts) in favour of the
 * check below. Never prints a hash or an email, nor an error's message (a
 * Prisma or JSON error quotes its input): errors print as name and code.
 * Auth0 user ids appear so skips can be followed up. After an APPLY drains, every written user is read back
 * through the same path sign-in uses, and one that does not read back as
 * holding a password is listed and fails the run.
 *
 * Reruns are safe by construction. Before an APPLY writes a user it appends
 * their user id to a ledger beside the export (`<export>.applied`), and every
 * run skips a user already in it. A latched user who errored or has not
 * folded may already have an attach event in the log, and a second attach
 * would mint another credential identifier and break a later identity
 * replay on the Account unique key. Retrying one is a decision: check the
 * user, then delete their line from the ledger.
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
  parseExport,
} from "./auth0-password-export";

const APPLY = process.env.APPLY === "1";

const REQUIRED = APPLY
  ? [
      "AUTH0_EXPORT_PATH",
      "DATABASE_URL",
      "REDIS_URL",
      "CLICKHOUSE_URL",
      "BASE_HOST",
      "ENVIRONMENT",
    ]
  : ["AUTH0_EXPORT_PATH", "DATABASE_URL"];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `ERROR: ${missing.join(", ")} not set. Nothing was read or written.`,
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
  console.log("About to WRITE credentials into:");
  console.log(`  postgres:    ${hostOf(process.env.DATABASE_URL)}`);
  console.log(`  redis:       ${hostOf(process.env.REDIS_URL)}`);
  console.log(`  clickhouse:  ${hostOf(process.env.CLICKHOUSE_URL)}`);
  console.log(`  environment: ${process.env.ENVIRONMENT}`);
  console.log(`  ledger:      ${LEDGER_PATH}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "yes" to continue: ');
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    throw new Error("Aborted. Nothing was written.");
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
    throw new Error("The migration queue exposes no completion barrier.");
  }
  return () => waitUntilIdle.call(queue);
}

type Listed =
  | "non_bcrypt"
  | "no_account"
  | "in_ledger"
  | "errored"
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
  skip(key: Listed, auth0UserId: string): void;
  n(key: Counted): number;
  listed: Record<Listed, string[]>;
  /** Users an APPLY wrote, or may have written before it threw. */
  toVerify: { auth0UserId: string; userId: string }[];
}

function newTally(): Tally {
  const counts = new Map<Counted, number>();
  const listed: Record<Listed, string[]> = {
    non_bcrypt: [],
    no_account: [],
    in_ledger: [],
    errored: [],
    not_visible: [],
  };
  const count = (key: Counted) => counts.set(key, (counts.get(key) ?? 0) + 1);
  return {
    count,
    skip: (key, auth0UserId) => {
      count(key);
      listed[key].push(auth0UserId);
    },
    n: (key) => counts.get(key) ?? 0,
    listed,
    toVerify: [],
  };
}

type Credentials = ReturnType<typeof credentialAccounts>;

async function writeRecord({
  auth0UserId,
  userId,
  hash,
  credentials,
  tally,
}: {
  auth0UserId: string;
  userId: string;
  hash: string;
  credentials: Credentials;
  tally: Tally;
}): Promise<void> {
  const latched = await isLatched({ userId });
  const planned = await credentials.planPasswordImport({ userId });
  // Ledgered BEFORE the write: a write that throws may still have staged an
  // attach, and that is exactly the user a rerun must not touch again.
  if (APPLY && planned !== "already_has_password") {
    appendFileSync(LEDGER_PATH, `${userId}\n`, { mode: 0o600 });
  }
  const outcome: PasswordImportOutcome =
    APPLY && planned !== "already_has_password"
      ? await credentials.importPasswordHash({ userId, passwordHash: hash })
      : planned;
  tally.count(outcome);
  if (outcome !== "already_has_password") {
    tally.count(latched ? "via_identity_events" : "via_legacy_row");
    if (APPLY) tally.toVerify.push({ auth0UserId, userId });
  }
  const tag = APPLY ? "OK " : "DRY";
  const note = latched ? " (latched)" : "";
  console.log(`  [${tag}] ${auth0UserId} -> ${outcome}${note}`);
}

async function tallyRecord({
  record,
  credentials,
  ledger,
  tally,
}: {
  record: Auth0ExportRecord;
  credentials: Credentials;
  ledger: Set<string>;
  tally: Tally;
}): Promise<void> {
  const auth0UserId = auth0UserIdOf(record);
  if (!auth0UserId) return tally.count("no_user_id");
  // A social or enterprise identity has no password to import.
  if (!auth0UserId.startsWith("auth0|")) {
    return tally.count("not_database_connection");
  }
  const hash = bcryptHashOf(record);
  if (!hash) return tally.skip("non_bcrypt", auth0UserId);

  let userId: string | null = null;
  try {
    userId = await credentials.findUserIdForFederatedPasswordAccount({
      federatedUserId: auth0UserId,
    });
    if (!userId) return tally.skip("no_account", auth0UserId);
    if (ledger.has(userId)) return tally.skip("in_ledger", auth0UserId);
    ledger.add(userId);
    await writeRecord({ auth0UserId, userId, hash, credentials, tally });
  } catch (error) {
    tally.skip("errored", auth0UserId);
    if (APPLY && userId) tally.toVerify.push({ auth0UserId, userId });
    console.error(`  [ERR] ${auth0UserId} -> ${describeErrorSafely(error)}`);
  }
}

/** Reads every write back the way sign-in will, after the events folded. */
async function verifyWrites({
  credentials,
  tally,
}: {
  credentials: Credentials;
  tally: Tally;
}): Promise<void> {
  for (const { auth0UserId, userId } of tally.toVerify) {
    const now = await credentials.planPasswordImport({ userId });
    if (now === "already_has_password") tally.count("verified");
    else tally.skip("not_visible", auth0UserId);
  }
}

function printSummary({ total, tally }: { total: number; tally: Tally }) {
  const { n } = tally;
  const verb = APPLY ? "" : "would ";
  console.log("\nSummary:");
  const row = (label: string, value: number) =>
    console.log(`  ${label.padEnd(36)} ${value}`);
  row("records in file:", total);
  row("skipped, no user_id:", n("no_user_id"));
  row("skipped, not auth0| (no password):", n("not_database_connection"));
  row("skipped, not bcrypt:", n("non_bcrypt"));
  row("skipped, no matching account:", n("no_account"));
  row("skipped, already a password:", n("already_has_password"));
  row("skipped, in ledger (earlier run):", n("in_ledger"));
  row(`${verb}create a credential:`, n("creates_credential"));
  row(`${verb}fill a passkey placeholder:`, n("fills_placeholder"));
  row("  of which latched (events):", n("via_identity_events"));
  row("  of which legacy (backfill):", n("via_legacy_row"));
  row("errored:", n("errored"));
  if (APPLY) {
    row("read back with a password:", n("verified"));
    row("NOT readable yet:", n("not_visible"));
  }

  for (const [label, ids] of [
    ["Not bcrypt, still on live Auth0", tally.listed.non_bcrypt],
    ["No matching account here", tally.listed.no_account],
    [
      "Already attempted by an earlier APPLY (see the ledger to retry)",
      tally.listed.in_ledger,
    ],
    [
      "Errored, needs a look (ledgered: a rerun skips them)",
      tally.listed.errored,
    ],
    [
      "Written but not readable yet (wait for the fold, then check)",
      tally.listed.not_visible,
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

  let drain: (() => Promise<void>) | null = null;
  if (APPLY) {
    await confirmApply();
    drain = await bootEventStack();
  }
  const credentials = credentialAccounts();
  const ledger = readLedger();
  const tally = newTally();

  for (const record of records) {
    await tallyRecord({ record, credentials, ledger, tally });
  }

  let drainFailure: string | null = null;
  if (drain) {
    console.log("\nWaiting for the staged identity events to fold...");
    await drain().catch((error: unknown) => {
      // The queue's own failure: identity events carry no hash.
      drainFailure = error instanceof Error ? error.message : String(error);
    });
    await verifyWrites({ credentials, tally });
  }

  printSummary({ total: records.length, tally });
  if (drainFailure) console.error(`\nDraining failed: ${drainFailure}`);
  const failed = tally.n("errored") + tally.n("not_visible") > 0;
  if (failed || drainFailure) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    // Every per-record failure is caught in tallyRecord, and parseExport
    // never quotes its input, so what reaches here carries no hash.
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await tryGetApp()?.close();
    await prisma.$disconnect();
    process.exit();
  });
