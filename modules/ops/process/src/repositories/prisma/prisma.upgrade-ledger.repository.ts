import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  imageSteps,
  type ServingRosterEntry,
  UpgradeLedgerRepository as ServingLedger,
} from "@langwatch/upgrade";
import { imageRelease, readImageCodeSteps, servingImageTree } from "@langwatch/upgrade/gate";
import {
  type Deprecation,
  loadDeprecations,
  loadReleaseBaseline,
  loadReleases,
} from "@langwatch/upgrade/manifest";
import {
  createUpgradeReader,
  imageVersionName,
  imageVersionOf,
  readBuildCommit,
  UNRELEASED_IMAGE,
  type ListRunsInput,
  type ListStepsFilter,
  type UpgradeImage,
  type UpgradeReader,
  type UpgradeImageVersion,
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

// The upgrade ledger describes the installation, not a tenant.
const LEDGER_TENANCY = `${skipTenantCheck({ SKIP_TENANT_CHECK: true }).sql}\n`;

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
    private readonly parts: {
      reader: UpgradeReader;
      runner: UpgradeRunnerRepository;
      serving: ServingLedger;
      version: UpgradeImageVersion;
    },
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
    const { manifests } = releases;
    const release = imageRelease({ manifests, tree: servingImageTree() }) ?? undefined;
    const shipped = imageSteps({ release: release ?? "0.0.0" });
    const version = imageVersionOf({
      release: release ?? null,
      containsRelease: manifests.at(-1)?.release ?? loadReleaseBaseline().release,
      commit: readBuildCommit(),
    });
    const postgres = {
      query: async <Row extends object>(text: string, values: unknown[] = []) => ({
        rows: await prisma.$queryRawUnsafe<Row[]>(`${LEDGER_TENANCY}${text}`, ...values),
      }),
    };
    return new PrismaUpgradeLedgerRepository({
      reader: createUpgradeReader({
        postgres,
        image: {
          release: release ?? UNRELEASED_IMAGE,
          name: imageVersionName(version),
          steps: steps ?? shipped,
        },
        needsOldWritersGone,
        planning: { image: { release: release ?? null, steps: shipped }, releases },
      }),
      runner: UpgradeRunnerRepository.create({ postgres }),
      serving: ServingLedger.create({ postgres }),
      version,
    });
  }

  findStatus(): Promise<UpgradeStatus> {
    return this.parts.reader.status();
  }

  findDeprecations(): Deprecation[] {
    return loadDeprecations();
  }

  findSteps(filter?: ListStepsFilter): Promise<UpgradeStepPage> {
    return this.parts.reader.listSteps(filter);
  }

  findReleases(): Promise<UpgradeReleasePage> {
    return this.parts.reader.listReleases();
  }

  findRuns(input?: ListRunsInput): Promise<UpgradeRunPage> {
    return this.parts.reader.listRuns(input);
  }

  getStep(input: { id: string }): Promise<UpgradeStepDetail> {
    return this.parts.reader.getStep(input);
  }

  getRun(input: { id: string }): Promise<UpgradeRunDetail> {
    return this.parts.reader.getRun(input);
  }

  findImageVersion(): UpgradeImageVersion {
    return this.parts.version;
  }

  findTargets(): Promise<UpgradeTargetSummary[]> {
    return this.parts.reader.listTargets();
  }

  reopenFailedStep({ id }: { id: string }): Promise<boolean> {
    return this.parts.runner.retryFailedStep({ id });
  }

  findLiveRoster({ staleAfterMs }: { staleAfterMs: number }): Promise<ServingRosterEntry[]> {
    return this.parts.serving.findLiveRoster({ staleAfterMs });
  }
}
