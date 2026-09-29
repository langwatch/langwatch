/**
 * One-time import of Auth0's password-hash export for the database-connection
 * (email+password, `auth0|...`) cohort — ADR-143.
 *
 * Auth0's bulk export supplies either a bcrypt `password_hash` string, or a
 * `custom_password_hash` object naming one of eleven algorithms (a tenant that
 * migrated a population INTO Auth0 from elsewhere before this deployment
 * existed carries those). Only bcrypt rows import here — `PasswordHasherPort`
 * and better-auth's own `password.verify` assume bcrypt, and nothing in this
 * script rehashes or reinterprets another algorithm's bytes as one. Every
 * other record is counted and listed by Auth0 user id in the summary, never
 * imported, and stays on the live Auth0 fallback until a follow-up handles it.
 *
 * Matches each record by its Auth0 `user_id` against the existing
 * `Account(provider: "auth0", providerAccountId: user_id)` row this
 * deployment already holds for that identity — not by email, which is
 * case-sensitivity-ambiguous and not a unique key on this table. A record
 * naming no such Account (created after the export, or never signed up here),
 * or naming a user who already holds a `credential` Account (already
 * imported, or already carries a native password), is skipped and counted.
 *
 * Writes through `PrismaCredentialAccountRepository.createCredentialAccount`
 * — the exact seam `CredentialAccountService.setFirstPassword` and
 * `openCredentialAccount` already write a `credential` Account through, with
 * the `issuer` column better-auth's own lookup requires. No SQL is hand-rolled
 * here, and no other table is touched.
 *
 * DRY-RUN BY DEFAULT: reports what it would do and writes nothing. Re-run
 * with APPLY=1 to write. DRY_RUN=1 is the explicit spelling of the default —
 * set it to force a dry run even if APPLY is also set (belt-and-braces for a
 * copy-pasted command), and to make a report-only run unambiguous in shell
 * history. In APPLY mode (and only once DRY_RUN has not overridden it),
 * prints the target database's host and name (never its credentials, never
 * the connection string) and asks for interactive confirmation before
 * touching a row — skip the prompt with CONFIRM=1 for a scripted re-run once
 * you have already confirmed once.
 *
 * Never prints a password hash, a `custom_password_hash` value, or an email
 * address. Auth0 user ids appear in output (they are already the opaque,
 * pseudonymous identifier this deployment stores in `providerAccountId`) so
 * an operator can follow up on anything skipped.
 *
 * Usage (run locally against prod, from a checkout with the export file on
 * disk — nothing this script does ever uploads, forwards or persists that
 * file anywhere beyond reading it):
 *   AUTH0_EXPORT_PATH=/path/to/export.json DATABASE_URL=<prod-url> \
 *     pnpm tsx scripts/ops/import-auth0-password-hashes.ts
 *   AUTH0_EXPORT_PATH=/path/to/export.json DATABASE_URL=<prod-url> APPLY=1 \
 *     pnpm tsx scripts/ops/import-auth0-password-hashes.ts
 *   AUTH0_EXPORT_PATH=/path/to/export.json DATABASE_URL=<prod-url> DRY_RUN=1 \
 *     pnpm tsx scripts/ops/import-auth0-password-hashes.ts
 *
 * Export format: accepts either a JSON array of records or newline-delimited
 * JSON (Auth0's bulk-export job output) — whichever Auth0 gave you.
 *
 * VERIFY THE FIELD NAMES AGAINST YOUR ACTUAL FILE BEFORE AN APPLY RUN. This
 * script was written against Auth0's documented bulk-import/export schema
 * (`user_id`, `password_hash`, `custom_password_hash.{algorithm,hash,salt}`),
 * not against a sample of the real export — the export was deliberately kept
 * local and off this session. Run without APPLY first and read the summary;
 * a field-name mismatch shows up there as "0 bcrypt-eligible" or "every
 * record non-bcrypt" rather than as a write to the wrong place.
 */
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { PrismaClient } from "~/generated/prisma/client";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";
import { PrismaCredentialAccountRepository } from "~/server/app-layer/identity/repositories/credential-account.prisma.repository";

const FORCE_DRY_RUN = process.env.DRY_RUN === "1";
const APPLY = process.env.APPLY === "1" && !FORCE_DRY_RUN;
const SKIP_CONFIRM = process.env.CONFIRM === "1";

const EXPORT_PATH = process.env.AUTH0_EXPORT_PATH;
if (!EXPORT_PATH) {
  console.error(
    "ERROR: AUTH0_EXPORT_PATH is not set. Point it at the local Auth0 export file. Nothing was read.",
  );
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set. Nothing was read or written.");
  process.exit(1);
}

/** One Auth0 export record — only the fields this script reads. */
interface Auth0HashValue {
  value: string;
  encoding?: "base64" | "hex" | "utf8";
}
interface Auth0CustomPasswordHash {
  algorithm: string;
  hash: Auth0HashValue;
}
interface Auth0ExportRecord {
  user_id?: unknown;
  _id?: unknown;
  password_hash?: unknown;
  custom_password_hash?: Auth0CustomPasswordHash;
}

/** `$2a$`, `$2b$` or `$2y$` — the three live bcrypt prefixes. */
const BCRYPT_PREFIX = /^\$2[aby]\$/;

function parseExport(raw: string): Auth0ExportRecord[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error(
        "Export file starts with '[' but did not parse to a JSON array.",
      );
    }
    return parsed as Auth0ExportRecord[];
  }
  // Newline-delimited JSON — Auth0's bulk-export job's own output shape.
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Auth0ExportRecord);
}

function auth0UserIdOf(record: Auth0ExportRecord): string | null {
  const id = record.user_id ?? record._id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function decodeHashValue(hash: Auth0HashValue): string {
  const encoding = hash.encoding ?? "utf8";
  return encoding === "utf8"
    ? hash.value
    : Buffer.from(hash.value, encoding).toString("utf8");
}

/** The record's bcrypt hash, or null where it carries none, or a different algorithm. */
function bcryptHashOf(record: Auth0ExportRecord): string | null {
  if (
    typeof record.password_hash === "string" &&
    BCRYPT_PREFIX.test(record.password_hash)
  ) {
    return record.password_hash;
  }
  if (record.custom_password_hash?.algorithm === "bcrypt") {
    const decoded = decodeHashValue(record.custom_password_hash.hash);
    return BCRYPT_PREFIX.test(decoded) ? decoded : null;
  }
  return null;
}

/** Prints only host/database from the URL — never credentials, never the raw string. */
async function confirmApply(databaseUrl: string): Promise<void> {
  let target = "<DATABASE_URL did not parse as a URL>";
  try {
    const url = new URL(databaseUrl);
    target = `${url.host}${url.pathname}`;
  } catch {
    // leave the placeholder — never print the raw value, which may carry credentials
  }
  console.log(`About to WRITE credential rows into ${target}.`);
  if (SKIP_CONFIRM) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "yes" to continue: ');
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("Aborted. Nothing was written.");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const forcedNote = FORCE_DRY_RUN ? " (forced by DRY_RUN=1)" : "";
  console.log(
    `Mode: ${APPLY ? "APPLY (writes rows)" : `DRY RUN (reports only)${forcedNote}`}\n`,
  );

  const raw = readFileSync(EXPORT_PATH as string, "utf8");
  const records = parseExport(raw);
  console.log(`Export file: ${records.length} record(s)`);

  const prisma = new PrismaClient({ adapter: createPrismaPgAdapter(DATABASE_URL) });
  const credentials = new PrismaCredentialAccountRepository(prisma);

  if (APPLY) await confirmApply(DATABASE_URL);

  let noIdSkipped = 0;
  let nonBcryptSkipped = 0;
  let noAccountSkipped = 0;
  let alreadyCredentialedSkipped = 0;
  let imported = 0;
  const nonBcryptUserIds: string[] = [];
  const noAccountUserIds: string[] = [];

  for (const record of records) {
    const auth0UserId = auth0UserIdOf(record);
    if (!auth0UserId) {
      noIdSkipped++;
      continue;
    }

    const hash = bcryptHashOf(record);
    if (!hash) {
      nonBcryptSkipped++;
      nonBcryptUserIds.push(auth0UserId);
      continue;
    }

    const account = await prisma.account.findFirst({
      where: { provider: "auth0", providerAccountId: auth0UserId },
      select: { userId: true },
    });
    if (!account) {
      noAccountSkipped++;
      noAccountUserIds.push(auth0UserId);
      continue;
    }

    const existingCredential = await prisma.account.findFirst({
      where: { userId: account.userId, provider: "credential" },
      select: { id: true },
    });
    if (existingCredential) {
      alreadyCredentialedSkipped++;
      continue;
    }

    if (APPLY) {
      await credentials.createCredentialAccount({
        userId: account.userId,
        passwordHash: hash,
      });
      console.log(`  [OK]  auth0|${auth0UserId} -> credential written`);
    } else {
      console.log(`  [DRY] auth0|${auth0UserId} -> would write a credential`);
    }
    imported++;
  }

  console.log("\nSummary:");
  console.log(`  records in file:                 ${records.length}`);
  console.log(`  skipped, no user_id field:        ${noIdSkipped}`);
  console.log(`  skipped, non-bcrypt algorithm:     ${nonBcryptSkipped}`);
  console.log(`  skipped, no matching account:      ${noAccountSkipped}`);
  console.log(`  skipped, already has a password:   ${alreadyCredentialedSkipped}`);
  const importedLabel = APPLY
    ? `  imported:                          ${imported}`
    : `  would import:                       ${imported}`;
  console.log(importedLabel);

  if (nonBcryptUserIds.length > 0) {
    console.log(
      "\nNon-bcrypt residual — still on live Auth0, needs a follow-up (auth0 user ids):",
    );
    for (const id of nonBcryptUserIds) console.log(`  auth0|${id}`);
  }
  if (noAccountUserIds.length > 0) {
    console.log("\nNo matching Account in this deployment (auth0 user ids):");
    for (const id of noAccountUserIds) console.log(`  auth0|${id}`);
  }

  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
