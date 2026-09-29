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
 * nothing. APPLY=1 writes; DRY_RUN=1 forces a dry run even beside APPLY=1.
 * An APPLY run boots the app's event-sourcing stack in the one-shot
 * `migration` role (as the system-migrations task does): it folds only the
 * identity events it staged itself, on an isolated dispatch allow-list, and
 * waits for them to drain before exiting. It therefore needs the target's
 * REDIS_URL, CLICKHOUSE_URL, BASE_HOST and ENVIRONMENT beside DATABASE_URL, all
 * pointing at the SAME deployment, and refuses to start without them. It asks
 * for "yes" before writing (CONFIRM=1 skips the prompt).
 *
 * Nothing here loads `.env`: the shell is the whole environment, and the app's
 * own env validation is skipped (skip-app-env-validation.ts) in favour of the
 * check below. Never prints a hash or an email; Auth0 user ids appear so skips
 * can be followed up. After an APPLY drains, every written user is read back
 * through the same path sign-in uses, and one that does not read back as
 * holding a password is listed and fails the run.
 *
 * Do not rerun a latched user who errored or did not read back until the
 * fold has caught up: their attach event may already be in the log, and a
 * rerun mints a second credential identifier under a new account id, which
 * breaks a later identity replay on the Account unique key.
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
import { readFileSync } from "node:fs";
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
import { redactUrl } from "~/server/clickhouse/goose";
import { prisma } from "~/server/db";

const FORCE_DRY_RUN = process.env.DRY_RUN === "1";
const APPLY = process.env.APPLY === "1" && !FORCE_DRY_RUN;
const SKIP_CONFIRM = process.env.CONFIRM === "1";

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

interface Auth0HashValue {
  value: string;
  encoding?: "base64" | "hex" | "utf8";
}
interface Auth0ExportRecord {
  user_id?: unknown;
  /** A string, or `{"$oid": ...}` in Auth0's password-hash export. */
  _id?: unknown;
  password_hash?: unknown;
  passwordHash?: unknown;
  custom_password_hash?: { algorithm?: unknown; hash?: Auth0HashValue };
}

/**
 * A whole bcrypt hash, not just its prefix: `Buffer.from` decodes malformed
 * hex or base64 silently, so a prefix check would pass truncated garbage.
 */
const BCRYPT_SHAPE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

function parseExport(raw: string): Auth0ExportRecord[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("Export starts with '[' but is not a JSON array.");
    }
    return parsed as Auth0ExportRecord[];
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Auth0ExportRecord);
}

function oidOf(id: unknown): unknown {
  return typeof id === "object" && id !== null && "$oid" in id ? id.$oid : id;
}

/** The Auth0 user id; a bare database-connection id gains its `auth0|`. */
function auth0UserIdOf(record: Auth0ExportRecord): string | null {
  const id = record.user_id ?? oidOf(record._id);
  if (typeof id !== "string" || id.length === 0) return null;
  return id.includes("|") ? id : `auth0|${id}`;
}

function bcryptHashOf(record: Auth0ExportRecord): string | null {
  const plain = record.password_hash ?? record.passwordHash;
  if (typeof plain === "string" && BCRYPT_SHAPE.test(plain)) return plain;
  const custom = record.custom_password_hash;
  if (
    typeof custom?.algorithm !== "string" ||
    custom.algorithm.toLowerCase() !== "bcrypt" ||
    typeof custom.hash?.value !== "string"
  ) {
    return null;
  }
  const encoding = custom.hash.encoding ?? "utf8";
  const decoded =
    encoding === "utf8"
      ? custom.hash.value
      : Buffer.from(custom.hash.value, encoding).toString("utf8");
  return BCRYPT_SHAPE.test(decoded) ? decoded : null;
}

async function confirmApply(): Promise<void> {
  console.log("About to WRITE credentials into:");
  console.log(`  postgres:   ${redactUrl(process.env.DATABASE_URL ?? "")}`);
  console.log(`  redis:      ${redactUrl(process.env.REDIS_URL ?? "")}`);
  console.log(`  clickhouse: ${redactUrl(process.env.CLICKHOUSE_URL ?? "")}`);
  console.log(`  environment: ${process.env.ENVIRONMENT}`);
  if (SKIP_CONFIRM) return;
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

type Listed = "non_bcrypt" | "no_account" | "errored" | "not_visible";

interface Tally {
  count(key: string): void;
  skip(key: Listed, auth0UserId: string): void;
  n(key: string): number;
  listed: Record<Listed, string[]>;
  /** Users an APPLY wrote, or may have written before it threw. */
  toVerify: { auth0UserId: string; userId: string }[];
}

function newTally(): Tally {
  const counts = new Map<string, number>();
  const listed: Record<Listed, string[]> = {
    non_bcrypt: [],
    no_account: [],
    errored: [],
    not_visible: [],
  };
  const count = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
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
  const outcome: PasswordImportOutcome = APPLY
    ? await credentials.importPasswordHash({ userId, passwordHash: hash })
    : await credentials.planPasswordImport({ userId });
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
  tally,
}: {
  record: Auth0ExportRecord;
  credentials: Credentials;
  tally: Tally;
}): Promise<void> {
  const auth0UserId = auth0UserIdOf(record);
  if (!auth0UserId) return tally.count("no_user_id");
  const hash = bcryptHashOf(record);
  if (!hash) return tally.skip("non_bcrypt", auth0UserId);

  let userId: string | null = null;
  try {
    userId = await credentials.findUserIdForFederatedPasswordAccount({
      federatedUserId: auth0UserId,
    });
    if (!userId) return tally.skip("no_account", auth0UserId);
    await writeRecord({ auth0UserId, userId, hash, credentials, tally });
  } catch (error) {
    tally.skip("errored", auth0UserId);
    if (APPLY && userId) tally.toVerify.push({ auth0UserId, userId });
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  [ERR] ${auth0UserId} -> ${message}`);
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
  console.log(`  records in file:                ${total}`);
  console.log(`  skipped, no user_id:            ${n("no_user_id")}`);
  console.log(`  skipped, not bcrypt:            ${n("non_bcrypt")}`);
  console.log(`  skipped, no matching account:   ${n("no_account")}`);
  console.log(`  skipped, already a password:    ${n("already_has_password")}`);
  console.log(`  ${verb}create a credential:      ${n("creates_credential")}`);
  console.log(`  ${verb}fill a passkey placeholder: ${n("fills_placeholder")}`);
  console.log(`    of which latched (events):   ${n("via_identity_events")}`);
  console.log(`    of which legacy (backfill):  ${n("via_legacy_row")}`);
  console.log(`  errored:                        ${n("errored")}`);
  if (APPLY) {
    console.log(`  read back with a password:      ${n("verified")}`);
    console.log(`  NOT readable yet:               ${n("not_visible")}`);
  }

  for (const [label, ids] of [
    ["Not bcrypt, still on live Auth0", tally.listed.non_bcrypt],
    ["No matching account here", tally.listed.no_account],
    [
      "Errored, needs a look (never rerun a latched one blind)",
      tally.listed.errored,
    ],
    [
      "Written but not readable yet (do not rerun; wait for the fold)",
      tally.listed.not_visible,
    ],
  ] as const) {
    if (ids.length === 0) continue;
    console.log(`\n${label} (auth0 user ids):`);
    for (const id of ids) console.log(`  ${id}`);
  }
}

async function main(): Promise<void> {
  const forced = FORCE_DRY_RUN ? " (forced by DRY_RUN=1)" : "";
  console.log(
    `Mode: ${APPLY ? "APPLY (writes)" : `DRY RUN (writes nothing)${forced}`}\n`,
  );

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
  const tally = newTally();

  for (const record of records) {
    await tallyRecord({ record, credentials, tally });
  }

  let drainFailure: string | null = null;
  if (drain) {
    console.log("\nWaiting for the staged identity events to fold...");
    await drain().catch((error: unknown) => {
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
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await tryGetApp()?.close();
    await prisma.$disconnect();
    process.exit();
  });
