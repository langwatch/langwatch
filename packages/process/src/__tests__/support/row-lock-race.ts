/**
 * Runs two writes on one Postgres row so the second parks on the first's row
 * lock and re-checks its WHERE clause against the row the first committed: the
 * overlap a conditional write must survive, staged rather than hoped for.
 */
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

const TRANSACTION_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 25;
const POLL_ATTEMPTS = 400;

async function waitUntil(ready: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`waited for ${what} and it never happened`);
}

/** Whether an UPDATE of this table is parked on another transaction's row lock. */
async function updateIsWaitingOnALock({
  prisma,
  table,
}: {
  prisma: PrismaClient;
  table: string;
}): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ waiting: bigint }[]>`
    -- @tenancy: reads the server's own activity view, which holds no tenant data.
    SELECT count(*) AS waiting
      FROM pg_stat_activity
     WHERE wait_event_type = 'Lock'
       AND datname = current_database()
       AND pid <> pg_backend_pid()
       AND query ILIKE '%UPDATE%'
       AND query ILIKE ${`%${table}%`}
  `;
  return Number(rows[0]?.waiting ?? 0) > 0;
}

/** Runs `first`, parks `second` behind it on the row lock, then commits `first`. */
export async function raceOnOneRow<T>({
  prisma,
  table,
  first,
  second,
}: {
  prisma: PrismaClient;
  table: string;
  first: (tx: Prisma.TransactionClient) => Promise<T>;
  second: (tx: Prisma.TransactionClient) => Promise<T>;
}): Promise<{ first: T; second: T }> {
  let release: () => void = () => void 0;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const answers: { first: T[] } = { first: [] };
  const firstRuns = prisma.$transaction(
    async (tx) => {
      answers.first.push(await first(tx));
      await held;
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );

  await waitUntil(() => answers.first.length > 0, "the first write to land");

  const secondRuns = prisma.$transaction(async (tx) => second(tx), {
    timeout: TRANSACTION_TIMEOUT_MS,
  });

  await waitUntil(
    () => updateIsWaitingOnALock({ prisma, table }),
    `an UPDATE of ${table} to park on the row lock`,
  );

  release();
  await firstRuns;

  const [firstAnswer] = answers.first;
  if (firstAnswer === undefined) throw new Error("the first write answered nothing");
  return { first: firstAnswer, second: await secondRuns };
}
