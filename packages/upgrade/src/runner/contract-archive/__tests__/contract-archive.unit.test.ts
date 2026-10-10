/**
 * Archive-or-fail over the archive store's memory twin.
 * Spec: packages/upgrade/specs/contract-archive.feature.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { imageContractArchives } from "../../../gate/image-tree.ts";
import { ContractArchiveService } from "../contract-archive.service.ts";
import { MemoryContractArchiveRepository } from "../memory.contract-archive.repository.ts";

const STEP = "prisma:20270101000000_drop_legacy";
const ARCHIVE = "_retired_LegacyKey_3_23_0";

const serviceOver = (store: MemoryContractArchiveRepository) =>
  ContractArchiveService.create({ store });

describe("imageContractArchives()", () => {
  /** @scenario "A contract step's SQL names the tables it archives" */
  it("reads each archive note of a contract and skips a contract with none", () => {
    const root = mkdtempSync(join(tmpdir(), "contract-archives-"));
    const directories = { prisma: join(root, "prisma"), goose: join(root, "goose") };
    try {
      mkdirSync(join(directories.prisma, "20270101000000_drop_legacy"), { recursive: true });
      mkdirSync(directories.goose, { recursive: true });
      writeFileSync(
        join(directories.prisma, "20270101000000_drop_legacy", "migration.sql"),
        '-- contract: retired in 3.20.1\n-- archive: LegacyKey\n-- archive: LegacyNote\nDROP TABLE "LegacyKey";\nDROP TABLE "LegacyNote";\n',
      );
      writeFileSync(
        join(directories.goose, "00110_drop_old_spans.sql"),
        "-- +goose Up\n-- contract: retired in 3.20.1\nDROP TABLE IF EXISTS old_spans;\n",
      );
      expect(imageContractArchives({ directories })).toEqual(
        new Map([[STEP, ["LegacyKey", "LegacyNote"]]]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ContractArchiveService", () => {
  /** @scenario "An archived table is copied and checked before the drop" */
  it("copies the table into its retired archive", async () => {
    const store = MemoryContractArchiveRepository.create();
    store.tables.set("LegacyKey", 3);
    const entries = await serviceOver(store).archive({
      step: STEP,
      tables: ["LegacyKey"],
      release: "3.23.0",
    });
    expect(entries).toMatchObject([{ archive: ARCHIVE, state: "copied", rows: 3 }]);
    expect(store.tables.get(ARCHIVE)).toBe(3);
  });

  /** @scenario "A copy that does not match the source fails the contract step" */
  it("fails naming the step when the source changes during the copy", async () => {
    const store = MemoryContractArchiveRepository.create({
      onCopy: (tables) => tables.set("LegacyKey", 4),
    });
    store.tables.set("LegacyKey", 3);
    await expect(
      serviceOver(store).archive({ step: STEP, tables: ["LegacyKey"], release: "3.23.0" }),
    ).rejects.toMatchObject({ code: "contract_archive_failed" });
  });

  /** @scenario "Archiving again copies nothing when the archive already matches" */
  it("copies nothing when the archive already holds the source's rows", async () => {
    const store = MemoryContractArchiveRepository.create();
    store.tables.set("LegacyKey", 3).set(ARCHIVE, 3);
    const entries = await serviceOver(store).archive({
      step: STEP,
      tables: ["LegacyKey"],
      release: "3.23.0",
    });
    expect(entries).toMatchObject([{ state: "archived" }]);
    expect(store.copies).toBe(0);
  });

  /** @scenario "A table already dropped after its archive is not archived again" */
  it("reports a dropped table with an archive as archived", async () => {
    const store = MemoryContractArchiveRepository.create();
    store.tables.set(ARCHIVE, 3);
    const entries = await serviceOver(store).archive({
      step: STEP,
      tables: ["LegacyKey"],
      release: "3.23.0",
    });
    expect(entries).toMatchObject([{ state: "archived", rows: 3 }]);
    expect(store.copies).toBe(0);
  });

  /** @scenario "A dry run reports what would be archived and copies nothing" */
  it("names the table, archive and rows without copying", async () => {
    const store = MemoryContractArchiveRepository.create();
    store.tables.set("LegacyKey", 3);
    const entries = await serviceOver(store).archive({
      step: STEP,
      tables: ["LegacyKey"],
      release: "3.23.0",
      dryRun: true,
    });
    expect(entries).toMatchObject([
      { table: "LegacyKey", archive: ARCHIVE, state: "would-copy", rows: 3 },
    ]);
    expect(store.tables.has(ARCHIVE)).toBe(false);
  });

  /** @scenario "A ClickHouse contract that asks for an archive fails" */
  it("fails a goose contract that asks for an archive", async () => {
    const store = MemoryContractArchiveRepository.create();
    await expect(
      serviceOver(store).archive({
        step: "clickhouse:00110",
        tables: ["old_spans"],
        release: "3.23.0",
      }),
    ).rejects.toMatchObject({ code: "contract_archive_failed" });
  });
});
