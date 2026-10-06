import { hostname } from "node:os";

import { storesOwner } from "@langwatch/process-stores/config";
import type { ScopedSecrets } from "@langwatch/secrets";
import pg from "pg";

import { UpgradeLedgerRepository } from "../ledger.repository.ts";
import { loadReleases } from "../manifest/manifest-loader.ts";
import type { ReleaseTreeSteps } from "../manifest/stamp.ts";
import type { UpgradePostgres } from "../ports.ts";
import { createPresence } from "../presence/presence.service.ts";
import { UpgradeRunnerRepository } from "../runner/runner-ledger.repository.ts";
import { type FirstInstallUpgrade, spawnFirstInstallUpgrade } from "./first-install-upgrade.ts";
import { imageGateSteps, readImageTree } from "./image-tree.ts";
import type { ServingRole, ServingVerdict } from "./serving-gate.ts";
import { createUpgradeGate, type UpgradeGate } from "./upgrade-gate.service.ts";

/** Presence refresh and stale bound (held question "cloud presence timings", default taken). */
export const PRESENCE_TIMING = { staleAfterMs: 60_000, refreshEveryMs: 15_000 } as const;

/** A process with no database (the memory tier) has no installation to be behind. */
const NO_LEDGER_GATE: UpgradeGate = {
  admit: async () => ({ admitted: true, outcome: "current" }),
  release: async () => undefined,
};

/**
 * The gate over an open ledger connection: an absent ledger reads as empty, the api's first
 * install runs `upgrade` once and asks again (Q10), and the connection closes on refusal or
 * release.
 */
export function upgradeGateOver({
  role,
  postgres,
  close,
  tree,
  release,
  withClickHouse,
  processId,
  firstInstall,
}: {
  role: ServingRole;
  postgres: UpgradePostgres;
  close: () => Promise<void>;
  tree: ReleaseTreeSteps;
  release: string | null;
  withClickHouse: boolean;
  processId: string;
  firstInstall: FirstInstallUpgrade;
}): UpgradeGate {
  const ledger = UpgradeLedgerRepository.create({ postgres });
  const runner = UpgradeRunnerRepository.create({ postgres });
  const { blockingSteps, declaredSteps } = imageGateSteps({ tree, withClickHouse });
  const gate = createUpgradeGate({
    role,
    processId,
    image: { release, blockingSteps, name: release ?? "unreleased", declaredSteps },
    ledger: {
      findSteps: async () => ((await runner.ledgerExists()) ? ledger.findSteps() : []),
      findRuns: async () => ((await runner.ledgerExists()) ? ledger.findRuns() : []),
    },
    presence: createPresence({ ledger, ...PRESENCE_TIMING }),
    schemaIsEmpty: async () => !(await runner.prismaHistoryExists()),
  });
  let closed: Promise<void> | null = null;
  const closeOnce = () => (closed ??= close());
  return {
    async admit(): Promise<ServingVerdict> {
      try {
        let verdict = await gate.admit();
        if (verdict.outcome === "first-install") {
          const exitCode = await firstInstall();
          verdict =
            exitCode === 0
              ? await gate.admit()
              : {
                  ...verdict,
                  refusal: `${verdict.refusal} The api ran it; it exited ${exitCode}.`,
                };
        }
        if (!verdict.admitted) await closeOnce();
        return verdict;
      } catch (error) {
        await closeOnce();
        throw error;
      }
    },
    async release() {
      try {
        await gate.release();
      } finally {
        await closeOnce();
      }
    },
  };
}

/** The gate's one connection, in the schema `?schema=` names, where the runner wrote the ledger. */
export function gatePoolConfig({ databaseUrl }: { databaseUrl: string }): pg.PoolConfig {
  const schema = URL.canParse(databaseUrl) ? new URL(databaseUrl).searchParams.get("schema") : null;
  return {
    connectionString: databaseUrl,
    max: 1,
    allowExitOnIdle: true,
    ...(schema ? { options: `-c search_path="${schema}"` } : {}),
  };
}

/**
 * `withUpgradeGate`'s factory for the api and worker (held question "mig-serving-gate data
 * source", default (a)): one connection of its own from the stores' `DATABASE_URL`, opened only
 * when the gate first asks. Specs: specs/upgrade/serving-gate.feature and entry-points.feature.
 */
export async function servingUpgradeGate({
  secrets,
  role,
}: {
  secrets: ScopedSecrets;
  role: ServingRole;
}): Promise<UpgradeGate> {
  const tree = readImageTree();
  const release = loadReleases().manifests.at(-1)?.release ?? null;
  return secrets.into(storesOwner.secrets.database, (database) =>
    secrets.into(storesOwner.secrets.clickhouse, (clickhouse) =>
      secrets.into(storesOwner.secrets.clickhouseRoutes, (routes) => {
        if (!database?.trim()) return NO_LEDGER_GATE;
        const pool = new pg.Pool(gatePoolConfig({ databaseUrl: database }));
        return upgradeGateOver({
          role,
          postgres: pool,
          close: () => pool.end(),
          tree,
          release,
          withClickHouse: Boolean(clickhouse?.trim()) || routes.size > 0,
          processId: `${hostname()}:${process.pid}:${role}`,
          firstInstall: spawnFirstInstallUpgrade(),
        });
      }),
    ),
  );
}
