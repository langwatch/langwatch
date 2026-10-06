import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { imageSteps } from "@langwatch/upgrade";
import { loadReleases } from "@langwatch/upgrade/manifest";
import {
  createUpgradeReader,
  type ListStepsFilter,
  type UpgradeImage,
  type UpgradeReader,
  type UpgradeStatus,
  type UpgradeStepPage,
} from "@langwatch/upgrade/reader";

import type { UpgradeLedgerRepository } from "../upgrade-ledger.repository.ts";

/** Marks the reader's SQL for the tenancy guard: the ledger is the install's, no tenant's. */
const LEDGER_TENANCY =
  "-- @tenancy: the upgrade ledger describes the installation, not a tenant.\n";

/**
 * The ledger over this process's Postgres, read against the steps this image ships, so a step
 * the ledger has not recorded reads as outstanding (Q-U8, default taken).
 */
export class PrismaUpgradeLedgerRepository implements UpgradeLedgerRepository {
  private constructor(private readonly reader: UpgradeReader) {}

  static create({
    prisma,
    steps,
  }: {
    prisma: Pick<PrismaClient, "$queryRawUnsafe">;
    steps?: UpgradeImage["steps"];
  }): PrismaUpgradeLedgerRepository {
    const { manifests, floor } = loadReleases();
    const release = manifests.at(-1)?.release;
    return new PrismaUpgradeLedgerRepository(
      createUpgradeReader({
        postgres: {
          query: async <Row extends object>(text: string, values: unknown[] = []) => ({
            rows: await prisma.$queryRawUnsafe<Row[]>(`${LEDGER_TENANCY}${text}`, ...values),
          }),
        },
        image: {
          release: release ?? "unreleased",
          steps: steps ?? imageSteps({ release: release ?? "0.0.0" }),
        },
        floor,
      }),
    );
  }

  findStatus(): Promise<UpgradeStatus> {
    return this.reader.status();
  }

  findSteps(filter?: ListStepsFilter): Promise<UpgradeStepPage> {
    return this.reader.listSteps(filter);
  }
}
