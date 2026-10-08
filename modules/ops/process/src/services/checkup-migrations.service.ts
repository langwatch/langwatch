import { CHECKUP_DOCS, type CheckVerdict } from "@langwatch/ops-contract";
import type { UpgradeStepView } from "@langwatch/upgrade/reader";

import type { CheckupFacts } from "../rules/checkup-facts.rules.ts";
import { reasonOf } from "../rules/checkup-text.rules.ts";

/** Statuses of a step with nothing left to do; any other status, known or not, is outstanding. */
const SETTLED_STATUSES: ReadonlySet<string> = new Set(["done", "not-needed"]);

/** How many step ids a row names before it counts the rest. */
const NAMED_STEPS_LIMIT = 5;

/** Each code sits beside a literal `code:` so the registry's dead-code scan sees it raised. */
const PENDING = {
  "postgres-schema": { code: "checkup_postgres_migrations_pending" },
  "clickhouse-schema": { code: "checkup_clickhouse_migrations_pending" },
} as const;

/** Each engine's failed step has its own code (round 18, U3-a). */
const FAILED = {
  "postgres-schema": { code: "checkup_postgres_migration_failed" },
  "clickhouse-schema": { code: "checkup_clickhouse_migration_failed" },
} as const;

const UPGRADE_FIX =
  "Run `pnpm task upgrade` from the app image, then restart. Operators can follow it on /ops/upgrades.";

const UPGRADE_STATUS_FIX =
  "Run `pnpm task upgrade status` from the app image to read the ledger, or `pnpm task upgrade` to create it. Operators can read it on /ops/upgrades.";

function nameSteps(steps: readonly UpgradeStepView[]): string {
  const named = steps.slice(0, NAMED_STEPS_LIMIT).map((step) => step.id);
  const rest = steps.length - named.length;
  return rest > 0 ? `${named.join(", ")} and ${rest} more` : named.join(", ");
}

export class CheckupMigrationsService {
  private constructor(private readonly facts: Pick<CheckupFacts, "upgrade">) {}

  static create(facts: Pick<CheckupFacts, "upgrade">): CheckupMigrationsService {
    return new CheckupMigrationsService(facts);
  }

  /** Both migration rows read the ledger the Upgrades page reads: one source, one answer. */
  async run({
    kind,
    engine,
  }: {
    kind: "postgres-schema" | "clickhouse-schema";
    engine: "Postgres" | "ClickHouse";
  }): Promise<CheckVerdict> {
    let steps: UpgradeStepView[];
    let noUpgradeRecorded: boolean;
    try {
      const [page, status] = await Promise.all([
        this.facts.upgrade.listSteps({ mode: "blocking" }),
        this.facts.upgrade.status(),
      ]);
      steps = page.items.filter((step) => step.kind === kind);
      noUpgradeRecorded = status.reason === "no-upgrade-recorded";
    } catch (error) {
      return {
        outcome: "unchecked",
        detail: `The upgrade ledger could not be read: ${reasonOf(error)}`,
        fix: UPGRADE_STATUS_FIX,
        docsPath: CHECKUP_DOCS.upgrade,
      };
    }
    if (steps.length === 0 && noUpgradeRecorded) {
      return {
        outcome: "unchecked",
        detail: `No upgrade is recorded yet, so ${engine} migrations cannot be compared.`,
        fix: UPGRADE_FIX,
        docsPath: CHECKUP_DOCS.upgrade,
      };
    }
    const failed = steps.filter((step) => step.status === "failed");
    if (failed.length > 0) {
      return {
        outcome: "refused",
        code: FAILED[kind].code,
        detail: `${failed.length} ${engine} migration(s) failed: ${nameSteps(failed)}.`,
        fix:
          "Read the error on /ops/upgrades or with `pnpm task upgrade status`, fix the cause, " +
          "then run `pnpm task upgrade` again: it resumes where it stopped.",
        docsPath: CHECKUP_DOCS.upgrade,
      };
    }
    const outstanding = steps.filter((step) => !SETTLED_STATUSES.has(step.status));
    if (outstanding.length > 0) {
      return {
        outcome: "refused",
        code: PENDING[kind].code,
        detail: `${outstanding.length} ${engine} migration(s) not applied: ${nameSteps(outstanding)}.`,
        fix: UPGRADE_FIX,
        docsPath: CHECKUP_DOCS.upgrade,
      };
    }
    return { outcome: "verified", detail: `Every ${engine} migration is applied.` };
  }
}
