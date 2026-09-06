/**
 * Binds the ClickHouse schema lock to a vitest file's lifetime.
 *
 * Separate from schemaLock.ts so the lock itself imports nothing from vitest:
 * its cross-process contention test runs contenders as plain node processes,
 * which cannot load a module that reaches for a test runner's internals.
 */
import { afterAll, beforeAll } from "vitest";
import { acquireClickHouseSchemaLock } from "./schemaLock";

/**
 * Holds the schema lock for a whole test file.
 *
 * Call it at file scope, above the first `describe` and above any hook the
 * file registers itself. It hangs the hooks on the root suite, which is what
 * covers a file with several top-level describes, and vitest runs `beforeAll`
 * in definition order and `afterAll` in reverse, so the lock is taken before
 * the first fixture writes anything and released after the last teardown.
 *
 * Every suite that writes `gateway_budget_ledger_events` or reads spend back
 * through `gateway_budget_scope_totals` needs this, not only the two that
 * replay the rebuild. The damage lands on the neighbour rather than on the
 * replay.
 */
export function holdClickHouseSchemaLockForFile(): void {
  let release: (() => void) | undefined;

  beforeAll(async () => {
    release = await acquireClickHouseSchemaLock();
  }, 120_000);

  afterAll(() => {
    release?.();
  });
}
