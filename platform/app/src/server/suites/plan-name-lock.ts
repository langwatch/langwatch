/**
 * A run plan is identified by its name, so the read that matches a name and
 * the write that creates the plan for it must be one step. Two runs of a name
 * no plan holds yet arrive together often: the REST API, the CLI, the MCP
 * server and the run dialog all derive the same name for the same scope and
 * targets, and a CI job runs several of them at once. Left unserialized, both
 * find nothing and both insert, and the project ends up with two plans of one
 * name, each holding half the run history.
 *
 * The lock is transaction-scoped and keyed by the project and the name key, so
 * it serializes only the runs that would collide. It follows the prior art in
 * `datasets/dataset-lock.ts` and `modelProviders/modelDefaults.repository.ts`.
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { planNameKey } from "./plan-name";

/**
 * Max wall-clock the locked transaction may run, the wait for the lock
 * included. The body itself is three small queries; the budget is for the
 * queue in front of it when many runs of one name start together. Prisma's
 * 5s default would fail the tail of that queue.
 */
const PLAN_NAME_TXN_TIMEOUT_MS = 15_000;

/**
 * Max wall-clock to wait for a connection from the pool before the
 * transaction starts. Separate from the run budget above.
 */
const PLAN_NAME_TXN_MAX_WAIT_MS = 10_000;

/**
 * Run `fn` inside a transaction holding the lock on one plan name in one
 * project. `fn` receives the transaction client, so the read that looks the
 * name up and the write that answers it commit as one unit and every query
 * stays on the connection the lock is held by.
 */
export const withPlanNameLock = async <T>(
  {
    prisma,
    projectId,
    name,
  }: {
    prisma: PrismaClient;
    projectId: string;
    name: string;
  },
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> =>
  prisma.$transaction(
    async (tx) => {
      // `$executeRaw`, not `$queryRaw`: pg_advisory_xact_lock returns `void`,
      // which $queryRaw cannot deserialize. $executeRaw runs the statement and
      // takes the lock as a side effect.
      await tx.$executeRaw`-- @tenancy: advisory-lock helper, the key names the project
SELECT pg_advisory_xact_lock(hashtextextended(${`run-plan-name:${projectId}:${planNameKey(name)}`}, 0))`;
      return fn(tx);
    },
    {
      timeout: PLAN_NAME_TXN_TIMEOUT_MS,
      maxWait: PLAN_NAME_TXN_MAX_WAIT_MS,
    },
  );
