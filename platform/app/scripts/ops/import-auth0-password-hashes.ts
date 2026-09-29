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
 * naming no such Account (created after the export, or never signed up here)
 * is skipped and counted. A user who already holds a `credential` Account
 * with a real password (already imported, or already changed their password
 * here) is also skipped; one whose `credential` Account is a passkey
 * placeholder (NULL password — a real, currently-shipping state written by
 * passkey sign-up) has that row given the imported password instead of being
 * treated as already-credentialed.
 *
 * Writes through `PrismaCredentialAccountRepository.createCredentialAccount`
 * (new row) or `.updateAccountPassword` (passkey placeholder) — the same two
 * seams `CredentialAccountService.setFirstPassword`, `openCredentialAccount`
 * and `changePassword` already write a `credential` Account through, with the
 * `issuer` column better-auth's own lookup requires. No SQL is hand-rolled
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
import { redactUrl } from "~/server/clickhouse/goose";
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

/**
 * A complete bcrypt hash: `$2a$`/`$2b$`/`$2y$`, a two-digit cost, and the
 * 53-character salt+digest. Checked in full, not just the prefix — Node's
 * `Buffer.from(str, "hex" | "base64")` decodes invalid input silently rather
 * than throwing, so a truncated or malformed `custom_password_hash` value
 * would otherwise pass a prefix-only check and reach `bcrypt.compare` as
 * plausible-looking garbage.
 */
const BCRYPT_SHAPE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

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
    BCRYPT_SHAPE.test(record.password_hash)
  ) {
    return record.password_hash;
  }
  if (record.custom_password_hash?.algorithm.toLowerCase() === "bcrypt") {
    const decoded = decodeHashValue(record.custom_password_hash.hash);
    return BCRYPT_SHAPE.test(decoded) ? decoded : null;
  }
  return null;
}

/** Prints only host/database from the URL — never credentials, never the raw string. */
async function confirmApply(databaseUrl: string): Promise<void> {
  console.log(`About to WRITE credential rows into ${redactUrl(databaseUrl)}.`);
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
  let errored = 0;
  const nonBcryptUserIds: string[] = [];
  const noAccountUserIds: string[] = [];
  const erroredUserIds: string[] = [];

  for (const record of records) {
    try {
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

      const existingCredential = await credentials.findCredentialAccount({
        userId: account.userId,
      });
      if (existingCredential && existingCredential.passwordHash !== null) {
        alreadyCredentialedSkipped++;
        continue;
      }

      // A passkey sign-up leaves a placeholder `credential` Account with a
      // NULL password (createPasskeyCredentialPlaceholder) — the unique
      // (provider, providerAccountId) index means that row already occupies
      // this user's slot, so it is updated in place rather than re-created.
      if (existingCredential) {
        if (APPLY) {
          await credentials.updateAccountPassword({
            userId: account.userId,
            accountId: existingCredential.id,
            passwordHash: hash,
          });
          console.log(`  [OK]  ${auth0UserId} -> passkey placeholder given a password`);
        } else {
          console.log(
            `  [DRY] ${auth0UserId} -> would give the passkey placeholder a password`,
          );
        }
      } else {
        if (APPLY) {
          await credentials.createCredentialAccount({
            userId: account.userId,
            passwordHash: hash,
          });
          console.log(`  [OK]  ${auth0UserId} -> credential written`);
        } else {
          console.log(`  [DRY] ${auth0UserId} -> would write a credential`);
        }
      }
      imported++;
    } catch (err) {
      errored++;
      const auth0UserId = auth0UserIdOf(record) ?? "<no user_id>";
      erroredUserIds.push(auth0UserId);
      console.error(`  [ERROR] ${auth0UserId} -> ${String(err)}`);
    }
  }

  console.log("\nSummary:");
  console.log(`  records in file:                 ${records.length}`);
  console.log(`  skipped, no user_id field:        ${noIdSkipped}`);
  console.log(`  skipped, non-bcrypt algorithm:     ${nonBcryptSkipped}`);
  console.log(`  skipped, no matching account:      ${noAccountSkipped}`);
  console.log(`  skipped, already has a password:   ${alreadyCredentialedSkipped}`);
  console.log(`  errored:                           ${errored}`);
  const importedLabel = APPLY
    ? `  imported:                          ${imported}`
    : `  would import:                       ${imported}`;
  console.log(importedLabel);

  if (nonBcryptUserIds.length > 0) {
    console.log(
      "\nNon-bcrypt residual — still on live Auth0, needs a follow-up (auth0 user ids):",
    );
    for (const id of nonBcryptUserIds) console.log(`  ${id}`);
  }
  if (noAccountUserIds.length > 0) {
    console.log("\nNo matching Account in this deployment (auth0 user ids):");
    for (const id of noAccountUserIds) console.log(`  ${id}`);
  }
  if (erroredUserIds.length > 0) {
    console.log("\nErrored — needs investigation (auth0 user ids):");
    for (const id of erroredUserIds) console.log(`  ${id}`);
  }

  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
