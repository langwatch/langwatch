/**
 * One contender for the schema lock, as its own process.
 *
 * Takes the lock, records that it entered the critical section, holds it
 * briefly, records that it left, and releases. Run several of these at once
 * against one lock file and the journal shows whether the lock actually
 * excludes: overlapping entries mean it does not.
 *
 * Usage: schemaLockContender.ts <lockPath> <journalPath> <id> <holdMs>
 */
import { appendFileSync } from "node:fs";
import { createSchemaLock } from "../schemaLock";

async function main(): Promise<void> {
  const [lockPath, journalPath, id, holdMs] = process.argv.slice(2);
  if (!lockPath || !journalPath || !id || !holdMs) {
    throw new Error(
      "usage: schemaLockContender.ts <lockPath> <journalPath> <id> <holdMs>",
    );
  }

  const lock = createSchemaLock({
    lockPath,
    waitTimeoutMs: 30_000,
    pollIntervalMs: 5,
  });

  const release = await lock.acquire();
  try {
    appendFileSync(journalPath, `enter ${id}\n`);
    await new Promise((resolve) => setTimeout(resolve, Number(holdMs)));
    appendFileSync(journalPath, `exit ${id}\n`);
  } finally {
    release();
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
