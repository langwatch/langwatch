/**
 * One contender for the schema lock, as its own process. Run several against
 * one lock file and the journal shows whether the lock excludes: overlapping
 * entries mean it does not. Args: <lockPath> <journalPath> <id> <holdMs>
 */
import { appendFileSync } from "node:fs";
import { ClickHouseSchemaLock } from "../../schema-lock.ts";

async function main(): Promise<void> {
  const [lockPath, journalPath, id, holdMs] = process.argv.slice(2);
  const usage = "usage: schemaLockContender.ts <lockPath> <journalPath> <id> <holdMs>";
  if (!lockPath) throw new Error(usage);
  if (!journalPath) throw new Error(usage);
  if (!id) throw new Error(usage);
  if (!holdMs) throw new Error(usage);

  const lock = ClickHouseSchemaLock.create({
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
