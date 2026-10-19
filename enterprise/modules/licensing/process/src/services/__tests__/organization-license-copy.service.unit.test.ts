/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { isMigrationStep, type MigrationStepReport } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { TEST_LICENSING_CONFIG } from "../../__tests__/testing.ts";
import { licensingProcessModule } from "../../licensing.module.ts";
import {
  MemoryOrganizationLicenseRepository,
  type OrganizationLicenseColumns,
} from "../../repositories/memory/memory.organization-license.repository.ts";
import type { OrganizationLicensePair } from "../../repositories/organization-license.repository.ts";
import { OrganizationLicenseCopyService } from "../organization-license-copy.service.ts";

const expiresAt = Temporal.Instant.from("2027-01-01T00:00:00Z");
const validatedAt = Temporal.Instant.from("2026-10-01T09:00:00Z");
/** Organization's columns written after any row these tests save. */
const columnsWrittenLater = Temporal.Instant.from("2099-01-01T00:00:00Z");

/** Organization's columns: three licensed organizations and one with none. */
function organizationColumns(): Map<string, OrganizationLicenseColumns> {
  return new Map<string, OrganizationLicenseColumns>([
    ["org-a", { licenseKey: "key-a", expiresAt, validatedAt }],
    ["org-b", { licenseKey: "key-b", expiresAt, validatedAt: null }],
    ["org-c", { licenseKey: "key-c", expiresAt: null, validatedAt: null }],
    ["org-free", { licenseKey: null }],
  ]);
}

/** The twin, recording every pair the copy overwrites; `afterRead` runs between read and write. */
function recordedCopy(
  licenses: MemoryOrganizationLicenseRepository,
  { batchSize, afterRead }: { batchSize?: number; afterRead?: () => Promise<void> } = {},
) {
  const overwritten: OrganizationLicensePair[] = [];
  const service = OrganizationLicenseCopyService.create({
    licenses: {
      findLicensePairs: async (input) => {
        const pairs = await licenses.findLicensePairs(input);
        await afterRead?.();
        return pairs;
      },
      overwriteLicenses: async (input) => {
        overwritten.push(...input.pairs);
        return licenses.overwriteLicenses(input);
      },
    },
    ...(batchSize === undefined ? {} : { batchSize }),
  });
  return { service, overwritten };
}

function run({
  service,
  dryRun = false,
  afterOrganizationId = null,
}: {
  service: OrganizationLicenseCopyService;
  dryRun?: boolean;
  afterOrganizationId?: string | null;
}) {
  const saved: MigrationStepReport[] = [];
  const done = service.copyFromOrganizations({
    dryRun,
    signal: new AbortController().signal,
    afterOrganizationId,
    onBatchDone: async ({ report }) => void saved.push(report),
  });
  return { done, saved };
}

const ownRows = async (licenses: MemoryOrganizationLicenseRepository) =>
  (await licenses.findLicensePairs({ afterOrganizationId: null, limit: 10 })).flatMap(
    ({ organizationId, own }) => (own === null ? [] : [{ organizationId, ...own }]),
  );

describe("OrganizationLicenseCopyService", () => {
  /** @scenario "The worker brings licensing's licence rows level with organization's columns" */
  it("copies each missing licence, overwrites the older row that differs and leaves the rest", async () => {
    const columns = organizationColumns();
    columns.set("org-b", { licenseKey: "key-b", expiresAt, updatedAt: columnsWrittenLater });
    columns.set("org-d", { licenseKey: "key-d", expiresAt, validatedAt });
    columns.set("org-e", { licenseKey: "key-e", expiresAt, validatedAt });
    const licenses = MemoryOrganizationLicenseRepository.create(columns);
    await licenses.saveLicense({
      organizationId: "org-b",
      license: { licenseKey: "key-b-renewed", expiresAt, validatedAt },
    });
    await licenses.saveLicense({
      organizationId: "org-d",
      license: { licenseKey: "key-d", expiresAt, validatedAt },
    });
    await licenses.saveLicense({
      organizationId: "org-e",
      license: { licenseKey: "key-e-renewed", expiresAt, validatedAt },
    });
    const { service, overwritten } = recordedCopy(licenses);

    const first = await run({ service }).done;
    const second = await run({ service }).done;

    expect(first).toMatchObject({ copied: 3, afterOrganizationId: "org-free" });
    expect(second).toMatchObject({ copied: 0, afterOrganizationId: "org-free" });
    expect(overwritten.map(({ organizationId }) => organizationId)).toEqual([
      "org-a",
      "org-b",
      "org-c",
    ]);
    await expect(ownRows(licenses)).resolves.toEqual([
      { organizationId: "org-a", licenseKey: "key-a", expiresAt, validatedAt },
      { organizationId: "org-b", licenseKey: "key-b", expiresAt, validatedAt: null },
      { organizationId: "org-c", licenseKey: "key-c", expiresAt: null, validatedAt: null },
      { organizationId: "org-d", licenseKey: "key-d", expiresAt, validatedAt },
      { organizationId: "org-e", licenseKey: "key-e-renewed", expiresAt, validatedAt },
    ]);
  });

  /** @scenario "The worker brings licensing's licence rows level with organization's columns" */
  it("leaves organization's columns as they were", async () => {
    const columns = organizationColumns();
    const licenses = MemoryOrganizationLicenseRepository.create(columns);

    await run({ service: recordedCopy(licenses).service }).done;

    expect(columns.get("org-a")).toEqual({ licenseKey: "key-a", expiresAt, validatedAt });
    await expect(licenses.organizationExists("org-free")).resolves.toBe(true);
    await expect(licenses.getOrganizationLicense("org-free")).resolves.toEqual({
      licenseKey: null,
    });
  });

  /** @scenario "A licence cleared on organization's columns alone is cleared on licensing's row" */
  it("clears the row an old writer left holding a key", async () => {
    const licenses = MemoryOrganizationLicenseRepository.create(
      new Map<string, OrganizationLicenseColumns>([
        ["org-x", { licenseKey: null, updatedAt: columnsWrittenLater }],
      ]),
    );
    await licenses.saveLicense({
      organizationId: "org-x",
      license: { licenseKey: "key-x", expiresAt, validatedAt },
    });

    await expect(run({ service: recordedCopy(licenses).service }).done).resolves.toMatchObject({
      copied: 1,
    });

    await expect(licenses.getOrganizationLicense("org-x")).resolves.toEqual({ licenseKey: null });
    await expect(licenses.findOrganizationsWithLicense()).resolves.toEqual([]);
  });

  /** @scenario "The licence copy keeps a row written after it read" */
  it("leaves a row a dual-write changed between the read and the overwrite", async () => {
    const licenses = MemoryOrganizationLicenseRepository.create(
      new Map([["org-b", { licenseKey: "key-b", expiresAt }]]),
    );
    const later = { licenseKey: "key-b-later", expiresAt, validatedAt };
    const { service } = recordedCopy(licenses, {
      afterRead: () => licenses.saveLicense({ organizationId: "org-b", license: later }),
    });

    await expect(run({ service }).done).resolves.toMatchObject({ copied: 0 });

    await expect(ownRows(licenses)).resolves.toEqual([{ organizationId: "org-b", ...later }]);
  });

  /** @scenario "The licence copy keeps a licence written to both sides between its reads" */
  it("leaves a licence a live write put on both sides after organization's columns were read", async () => {
    const columns = new Map<string, OrganizationLicenseColumns>([
      ["org-b", { licenseKey: "key-b", expiresAt }],
    ]);
    const licenses = MemoryOrganizationLicenseRepository.create(columns);
    const later = { licenseKey: "key-b-later", expiresAt, validatedAt };
    const service = OrganizationLicenseCopyService.create({
      licenses: {
        // Organization's columns are read before the live write, licensing's row after it.
        findLicensePairs: async (input) => {
          const before = await licenses.findLicensePairs(input);
          await licenses.saveLicense({ organizationId: "org-b", license: later });
          columns.set("org-b", later);
          const after = await licenses.findLicensePairs(input);
          return before.map((pair, index) => ({
            ...pair,
            own: after[index]?.own ?? null,
            ownUpdatedAt: after[index]?.ownUpdatedAt ?? null,
          }));
        },
        overwriteLicenses: (input) => licenses.overwriteLicenses(input),
      },
    });

    await expect(run({ service }).done).resolves.toMatchObject({ copied: 0 });

    await expect(ownRows(licenses)).resolves.toEqual([{ organizationId: "org-b", ...later }]);
    expect(columns.get("org-b")).toEqual(later);
  });

  /** @scenario "A dry run of the licence copy writes nothing" */
  it("reports what it would copy and writes neither a row nor a checkpoint", async () => {
    const licenses = MemoryOrganizationLicenseRepository.create(organizationColumns());
    const { service, overwritten } = recordedCopy(licenses, { batchSize: 2 });

    const { done, saved } = run({ service, dryRun: true });

    await expect(done).resolves.toMatchObject({ wouldCopy: 3, copied: 0 });
    expect(saved).toEqual([]);
    expect(overwritten).toEqual([]);
    await expect(ownRows(licenses)).resolves.toEqual([]);
  });

  /** @scenario "An interrupted licence copy resumes after the last organization it saved" */
  it("saves a checkpoint per batch and resumes after the saved organization", async () => {
    const licenses = MemoryOrganizationLicenseRepository.create(organizationColumns());
    const { service, overwritten } = recordedCopy(licenses, { batchSize: 2 });

    const resumed = run({ service, afterOrganizationId: "org-b" });

    await expect(resumed.done).resolves.toMatchObject({ copied: 1 });
    expect(overwritten.map(({ organizationId }) => organizationId)).toEqual(["org-c"]);
    expect(resumed.saved).toEqual([{ afterOrganizationId: "org-free", copied: 1, wouldCopy: 0 }]);
  });
});

describe("given the licensing module installed on a worker", () => {
  /** @scenario "The worker collects licensing's licence copy as a background step" */
  it("declares the licence copy as a background data step that waits for old writers", async () => {
    const state = await licensingProcessModule.install({
      resources: new ResourceScope(),
      config: TEST_LICENSING_CONFIG,
      repositorySelection: { tier: "memory", members: {} },
      role: "worker",
      secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
      resolve: () => createApiFixture<never>(),
    });
    const step = (state.migrationSteps ?? [])
      .filter(isMigrationStep)
      .find(({ id }) => id === "licensing:copy-organization-licenses");
    const saved: MigrationStepReport[] = [];

    expect(step).toMatchObject({ kind: "data", mode: "background", needsOldWritersGone: true });
    await expect(
      step?.run({
        checkpoint: { resumeFrom: null, save: async ({ report }) => void saved.push(report) },
        dryRun: false,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ copied: 0 });
    expect(saved).toEqual([]);
  });
});
