import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  imageSteps,
  type ServingRosterEntry,
  UpgradeLedgerRepository as ServingLedger,
} from "@langwatch/upgrade";
import { readImageCodeSteps } from "@langwatch/upgrade/gate";
import { type Deprecation, loadDeprecations, loadReleases } from "@langwatch/upgrade/manifest";
import {
  createUpgradeReader,
  type ListRunsInput,
  type ListStepsFilter,
  type UpgradeImage,
  type UpgradeReader,
  type UpgradePreview,
  type UpgradeReleasePage,
  type UpgradeRunDetail,
  type UpgradeRunPage,
  type UpgradeStatus,
  type UpgradeStepDetail,
  type UpgradeStepPage,
  type UpgradeTargetSummary,
} from "@langwatch/upgrade/reader";
import { UpgradeRunnerRepository } from "@langwatch/upgrade/runner";

import type { UpgradeLedgerRepository } from "../upgrade-ledger.repository.ts";

/** Marks the reader's SQL for the tenancy guard: the ledger is the install's, no tenant's. */
const LEDGER_TENANCY =
  "-- @tenancy: the upgrade ledger describes the installation, not a tenant.\n";

/** The image's code steps that wait until no serving process lacks them (WAITINGON-LOOKUP). */
function waitingCodeSteps(): ReadonlySet<string> {
  return new Set(
    readImageCodeSteps()
      .filter((step) => step.needsOldWritersGone)
      .map((step) => step.id),
  );
}

/**
 * The ledger over this process's Postgres, read against the steps this image ships, so a step
 * the ledger has not recorded reads as outstanding (Q-U8, default taken).
 */
export class PrismaUpgradeLedgerRepository implements UpgradeLedgerRepository {
  private constructor(
    private readonly reader: UpgradeReader,
    private readonly runner: UpgradeRunnerRepository,
    private readonly serving: ServingLedger,
  ) {}

  static create({
    prisma,
    steps,
    needsOldWritersGone = waitingCodeSteps(),
  }: {
    prisma: Pick<PrismaClient, "$queryRawUnsafe">;
    steps?: UpgradeImage["steps"];
    needsOldWritersGone?: ReadonlySet<string>;
  }): PrismaUpgradeLedgerRepository {
    const releases = loadReleases();
    const { manifests, floor } = releases;
    const release = manifests.at(-1)?.release;
    const shipped = imageSteps({ release: release ?? "0.0.0" });
    const postgres = {
      query: async <Row extends object>(text: string, values: unknown[] = []) => ({
        rows: await prisma.$queryRawUnsafe<Row[]>(`${LEDGER_TENANCY}${text}`, ...values),
      }),
    };
    return new PrismaUpgradeLedgerRepository(
      createUpgradeReader({
        postgres,
        image: {
          release: release ?? "unreleased",
          steps: steps ?? shipped,
        },
        floor,
        needsOldWritersGone,
        planning: { image: { release: release ?? null, steps: shipped }, releases },
      }),
      UpgradeRunnerRepository.create({ postgres }),
      ServingLedger.create({ postgres }),
    );
  }

  findStatus(): Promise<UpgradeStatus> {
    return this.reader.status();
  }

  findDeprecations(): Deprecation[] {
    return loadDeprecations();
  }

  findSteps(filter?: ListStepsFilter): Promise<UpgradeStepPage> {
    return this.reader.listSteps(filter);
  }

  findReleases(): Promise<UpgradeReleasePage> {
    return this.reader.listReleases();
  }

  findRuns(input?: ListRunsInput): Promise<UpgradeRunPage> {
    return this.reader.listRuns(input);
  }

  getStep(input: { id: string }): Promise<UpgradeStepDetail> {
    return this.reader.getStep(input);
  }

  getRun(input: { id: string }): Promise<UpgradeRunDetail> {
    return this.reader.getRun(input);
  }

  findPreview(input: { to: string }): Promise<UpgradePreview> {
    return this.reader.preview(input);
  }

  findTargets(): Promise<UpgradeTargetSummary[]> {
    return this.reader.listTargets();
  }

  reopenFailedStep({ id }: { id: string }): Promise<boolean> {
    return this.runner.retryFailedStep({ id });
  }

  findLiveRoster({ staleAfterMs }: { staleAfterMs: number }): Promise<ServingRosterEntry[]> {
    return this.serving.findLiveRoster({ staleAfterMs });
  }
}
