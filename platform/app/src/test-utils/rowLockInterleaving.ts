/**
 * Runs two writes against the same Postgres row in the order that decides
 * whether a conditional write is exclusive.
 *
 * A test that just fires both writes at once passes on a fast machine and fails
 * on a slow one, because the two statements only overlap when the first is
 * still uncommitted as the second arrives. This makes that overlap the whole
 * point: the first write runs in a transaction that stays open, the second is
 * started and left to park on the row lock, and only once Postgres reports it
 * waiting does the first commit. The second then re-checks its WHERE clause
 * against the row as the first left it, which is the behaviour under test.
 *
 * A write whose conditions sit in a subquery rather than against the table
 * passes the re-check on its own older snapshot and wins anyway, which is the
 * failure this catches.
 */

import type { Prisma, PrismaClient } from "~/generated/prisma/client";

/** Long enough to survive a loaded machine, short enough to fail a deadlock. */
const TRANSACTION_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 25;
const POLL_ATTEMPTS = 400;

async function waitUntil(
  ready: () => boolean | Promise<boolean>,
  what: string,
): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`waited for ${what} and it never happened`);
}

/**
 * Whether Postgres has an UPDATE of this table parked on another transaction's
 * row lock. Matched loosely on the statement text, because a query builder and
 * hand-written SQL spell the same write differently and this has to see either.
 */
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

/**
 * Runs `first` and `second` against the same row with `second` blocked on
 * `first` until `first` commits, and answers with what each of them returned.
 */
export async function raceOnOneRow<T>({
  prisma,
  table,
  first,
  second,
}: {
  prisma: PrismaClient;
  /** The table both writes update, as it appears in the statement text. */
  table: string;
  first: (tx: Prisma.TransactionClient) => Promise<T>;
  second: (tx: Prisma.TransactionClient) => Promise<T>;
}): Promise<{ first: T; second: T }> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  let firstAnswer: { value: T } | null = null;
  const firstRuns = prisma.$transaction(
    async (tx) => {
      firstAnswer = { value: await first(tx) };
      await held;
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );

  await waitUntil(() => firstAnswer !== null, "the first write to land");

  const secondRuns = prisma.$transaction(async (tx) => second(tx), {
    timeout: TRANSACTION_TIMEOUT_MS,
  });

  await waitUntil(
    () => updateIsWaitingOnALock({ prisma, table }),
    `an UPDATE of ${table} to park on the row lock`,
  );

  release();
  await firstRuns;

  const answered = firstAnswer as { value: T } | null;
  if (!answered) throw new Error("the first write answered nothing");
  return { first: answered.value, second: await secondRuns };
}
